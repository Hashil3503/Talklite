package com.talklite.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionResponse;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.JoinRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 채팅 전달 지연 실측 (계획 5-5).
 * 실제 서버 + 실제 WebSocket(STOMP) 세션으로 발신 시각과 수신 시각의 차이를 측정한다.
 * - 단일 메시지: 서로 다른 두 사용자 간 send-to-receive 지연
 * - 동시 부하: 5명 × 20건 = 100건, 모든 구독자가 모든 메시지를 수신하는지 확인 후 mean / p95 산출
 * 전달 누락 또는 p95 >= 1000ms 인 경우에만 실패한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class ChatLatencyIntegrationTest extends IntegrationTestCleanup {

    private static final int SENDERS = 5;
    private static final int MESSAGES_PER_SENDER = 20;
    private static final long P95_BUDGET_MS = 1000L;
    private static final long RECEIVE_TIMEOUT_MS = 30_000L;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @LocalServerPort
    private int port;

    /** 수신 프레임의 clientRequestId 와 도착 시각(nanoTime) 을 그대로 기록하는 STOMP 클라이언트. */
    private final class RecordingStompClient {

        private final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        private final Map<String, Long> receivedAtNanos = new ConcurrentHashMap<>();
        private final WebSocketSession session;

        RecordingStompClient(String token) throws Exception {
            TextWebSocketHandler handler = new TextWebSocketHandler() {
                @Override
                public void handleTextMessage(WebSocketSession s, TextMessage message) {
                    long now = System.nanoTime();
                    String requestId = requestId(message.getPayload());
                    if (requestId != null) {
                        receivedAtNanos.putIfAbsent(requestId, now);
                    }
                    frames.add(message.getPayload());
                }
            };
            session = new StandardWebSocketClient().execute(
                    handler,
                    new WebSocketHttpHeaders(),
                    new URI("ws://localhost:" + port + "/ws")
            ).get(5, TimeUnit.SECONDS);
            session.sendMessage(new TextMessage(
                    "CONNECT\naccept-version:1.2\nAuthorization:Bearer " + token + "\nheart-beat:0,0\n\n\u0000"));
            frames.poll(5, TimeUnit.SECONDS);
        }

        void subscribe(String destination) throws Exception {
            session.sendMessage(new TextMessage(
                    "SUBSCRIBE\nid:sub-" + System.nanoTime() + "\ndestination:" + destination + "\n\n\u0000"));
            Thread.sleep(100);
        }

        /** 발신 직전 시각을 반환한다. */
        long send(String destination, String jsonBody) throws Exception {
            long sentAt = System.nanoTime();
            session.sendMessage(new TextMessage(
                    "SEND\ndestination:" + destination + "\ncontent-type:application/json\n\n" + jsonBody + "\u0000"));
            return sentAt;
        }

        /** expectedIds 를 모두 수신할 때까지 대기하고, 수신 시각 맵을 반환한다. */
        Map<String, Long> awaitAll(Set<String> expectedIds) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(RECEIVE_TIMEOUT_MS);
            while (System.nanoTime() < deadline) {
                if (receivedAtNanos.keySet().containsAll(expectedIds)) {
                    return Map.copyOf(receivedAtNanos);
                }
                String frame = frames.poll(200, TimeUnit.MILLISECONDS);
                if (frame == null) {
                    continue;
                }
                String requestId = requestId(frame);
                if (requestId != null) {
                    receivedAtNanos.putIfAbsent(requestId, System.nanoTime());
                }
            }
            return Map.copyOf(receivedAtNanos);
        }

        void close() {
            try {
                session.close();
            } catch (Exception ignored) {
            }
        }
    }

    private String requestId(String payload) {
        if (payload == null || !payload.contains("clientRequestId")) {
            return null;
        }
        // STOMP 프레임은 "COMMAND\nheader:value\n\n<body>\0" 형태이므로 본문만 파싱한다.
        int bodyStart = payload.indexOf("\n\n");
        if (bodyStart < 0) {
            return null;
        }
        String body = payload.substring(bodyStart + 2).replace("\u0000", "").trim();
        try {
            JsonNode node = objectMapper.readTree(body);
            JsonNode requestId = node.get("clientRequestId");
            return requestId == null || requestId.isNull() ? null : requestId.asText();
        } catch (Exception parseFailure) {
            return null;
        }
    }

    private String createRoom(String host) throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Latency Game", List.of("latency"), SENDERS,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class).id();
    }

    private void join(String roomId, String user) throws Exception {
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor(user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                .andExpect(status().isOk());
    }

    private static double percentileMillis(List<Double> values, double percentile) {
        List<Double> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int index = (int) Math.ceil(percentile * sorted.size()) - 1;
        return sorted.get(Math.max(0, Math.min(sorted.size() - 1, index)));
    }

    private static double mean(List<Double> values) {
        return values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    @Test
    @DisplayName("계획 5-5: 실제 WebSocket 채팅 단일/동시 전달 지연 측정 (p95 < 1000ms, 전달 누락 없음)")
    void measuresChatDeliveryLatency() throws Exception {
        // ---------- 1) 단일 메시지: 서로 다른 두 사용자 ----------
        String singleRoomId = createRoom("latency-host");
        join(singleRoomId, "latency-peer");

        RecordingStompClient receiver = new RecordingStompClient(sessionService.create("latency-peer").token());
        receiver.subscribe("/topic/room/" + singleRoomId + "/chat");
        RecordingStompClient singleSender = new RecordingStompClient(sessionService.create("latency-host").token());
        singleSender.subscribe("/topic/room/" + singleRoomId + "/chat");

        long singleSentAt = singleSender.send("/app/room/" + singleRoomId + "/chat",
                "{\"clientRequestId\":\"single-1\",\"content\":\"latency ping\"}");
        Map<String, Long> singleReceived = receiver.awaitAll(Set.of("single-1"));
        assertTrue(singleReceived.containsKey("single-1"), "단일 메시지가 수신되어야 한다");
        double singleLatencyMs = (singleReceived.get("single-1") - singleSentAt) / 1_000_000.0;

        System.out.println("[CHAT-LATENCY] single-message: count=1, latency="
                + round(singleLatencyMs) + "ms");

        singleSender.close();
        receiver.close();

        // ---------- 2) 동시 부하: 5명 × 20건 ----------
        String roomId = createRoom("sender-0");
        for (int i = 1; i < SENDERS; i++) {
            join(roomId, "sender-" + i);
        }

        List<SessionResponse> sessions = new ArrayList<>();
        for (int i = 0; i < SENDERS; i++) {
            sessions.add(sessionService.create("sender-" + i));
        }

        List<RecordingStompClient> clients = new ArrayList<>();
        for (SessionResponse session : sessions) {
            RecordingStompClient client = new RecordingStompClient(session.token());
            client.subscribe("/topic/room/" + roomId + "/chat");
            clients.add(client);
        }

        Map<String, Long> sentAtNanos = new ConcurrentHashMap<>();
        CountDownLatch ready = new CountDownLatch(SENDERS);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(SENDERS);
        ExecutorService pool = Executors.newFixedThreadPool(SENDERS);
        try {
            for (int userIndex = 0; userIndex < SENDERS; userIndex++) {
                RecordingStompClient client = clients.get(userIndex);
                String prefix = "u" + userIndex;
                pool.execute(() -> {
                    ready.countDown();
                    try {
                        start.await();
                        for (int messageIndex = 0; messageIndex < MESSAGES_PER_SENDER; messageIndex++) {
                            String requestId = prefix + "-m" + messageIndex;
                            long sentAt = client.send("/app/room/" + roomId + "/chat",
                                    "{\"clientRequestId\":\"" + requestId + "\",\"content\":\"load " + requestId + "\"}");
                            sentAtNanos.put(requestId, sentAt);
                        }
                    } catch (Exception sendFailure) {
                        throw new IllegalStateException(sendFailure);
                    } finally {
                        done.countDown();
                    }
                });
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS), "모든 송신 스레드가 준비되어야 한다");
            start.countDown();
            assertTrue(done.await(30, TimeUnit.SECONDS), "모든 송신이 30초 내에 완료되어야 한다");
        } finally {
            pool.shutdownNow();
        }

        Set<String> expectedIds = sentAtNanos.keySet();
        List<Double> latencies = new ArrayList<>();
        List<String> missingDeliveries = new ArrayList<>();
        for (int userIndex = 0; userIndex < SENDERS; userIndex++) {
            Map<String, Long> received = clients.get(userIndex).awaitAll(expectedIds);
            Set<String> missing = expectedIds.stream()
                    .filter(id -> !received.containsKey(id))
                    .collect(Collectors.toCollection(java.util.TreeSet::new));
            if (!missing.isEmpty()) {
                missingDeliveries.add("sender-" + userIndex + ": missing " + missing.size()
                        + " of " + expectedIds.size() + " " + missing);
                continue;
            }
            for (Map.Entry<String, Long> entry : new LinkedHashMap<>(received).entrySet()) {
                Long sentAt = sentAtNanos.get(entry.getKey());
                if (sentAt != null) {
                    latencies.add((entry.getValue() - sentAt) / 1_000_000.0);
                }
            }
        }

        for (RecordingStompClient client : clients) {
            client.close();
        }

        assertTrue(missingDeliveries.isEmpty(),
                "모든 구독자가 모든 메시지를 수신해야 한다: " + missingDeliveries);

        int count = latencies.size();
        assertEquals(SENDERS * MESSAGES_PER_SENDER * SENDERS, count, "측정 샘플 수 = 구독자 수 × 메시지 수");
        double meanMs = round(mean(latencies));
        double p95Ms = round(percentileMillis(latencies, 0.95));
        double maxMs = round(latencies.stream().mapToDouble(Double::doubleValue).max().orElse(0.0));

        System.out.println("[CHAT-LATENCY] concurrent: count=" + count
                + ", mean=" + meanMs + "ms"
                + ", p95=" + p95Ms + "ms"
                + ", max=" + maxMs + "ms");

        assertTrue(p95Ms < P95_BUDGET_MS,
                "채팅 p95 전달 지연은 1000ms 미만이어야 한다 (실측 " + p95Ms + "ms)");
    }
}
