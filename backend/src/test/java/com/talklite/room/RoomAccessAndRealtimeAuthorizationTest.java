package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.chat.PermanentRoomChatRepository;
import com.talklite.realtime.StompTestClient;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class RoomAccessAndRealtimeAuthorizationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PermanentRoomChatRepository permanentRoomChatRepository;

    @LocalServerPort
    private int port;

    private String createRoom(String host, RoomScope scope, RoomType type) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Auth Game", List.of("sec"), 6, scope, type, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class).id();
    }

    private void join(String roomId, String user) throws Exception {
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor(user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                .andExpect(status().isOk());
    }

    // ---------- H2: REST ----------

    @Test
    @DisplayName("T-H2-01: 토큰 없이 방 조회/대화 조회는 401")
    void roomReadsRequireAuthentication() throws Exception {
        String roomId = createRoom("h2-host-1", RoomScope.PUBLIC, RoomType.PERMANENT);

        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/rooms/" + roomId + "/messages"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T-H2-02: 비공개 방 - 비멤버 토큰은 403 not_a_member, 멤버는 200")
    void privateRoomOnlyVisibleToMembers() throws Exception {
        String roomId = createRoom("h2-host-2", RoomScope.PRIVATE, RoomType.PERMANENT);

        mockMvc.perform(get("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor("h2-outsider-2")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("not_a_member"));
        mockMvc.perform(get("/api/rooms/" + roomId + "/messages")
                        .header("Authorization", tokenFor("h2-outsider-2")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("not_a_member"));

        mockMvc.perform(get("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor("h2-host-2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(roomId));
        mockMvc.perform(get("/api/rooms/" + roomId + "/messages")
                        .header("Authorization", tokenFor("h2-host-2")))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T-H2-03: 공개 방은 어떤 유효 토큰으로도 200")
    void publicRoomVisibleToAnyAuthenticatedUser() throws Exception {
        String roomId = createRoom("h2-host-3", RoomScope.PUBLIC, RoomType.TEMPORARY);

        mockMvc.perform(get("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor("h2-stranger-3")))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/rooms/" + roomId + "/messages")
                        .header("Authorization", tokenFor("h2-stranger-3")))
                .andExpect(status().isOk());
    }

    // ---------- H2: STOMP SUBSCRIBE ----------

    @Test
    @DisplayName("T-H2-04: 비허용 STOMP 구독(/signal/다른UID, /topic/**, /topic/foo)은 거부된다")
    void disallowedSubscriptionsAreRejected() throws Exception {
        String roomId = createRoom("h2-host-4", RoomScope.PUBLIC, RoomType.TEMPORARY);
        String token = sessionService.create("h2-host-4").token();

        for (String destination : List.of(
                "/topic/room/" + roomId + "/signal/h2-other-uid",
                "/topic/**",
                "/topic/foo",
                "/user/queue/private")) {
            StompTestClient client = new StompTestClient(port, token);
            try {
                client.subscribe(destination);
                String frame = client.await(1);
                assertNotNull(frame, "구독 거부 ERROR 프레임 수신: " + destination);
                assertTrue(frame.startsWith("ERROR"), "구독이 거부되어야 한다: " + destination);
            } finally {
                client.close();
            }
        }
    }

    @Test
    @DisplayName("T-H2-05: 허용 구독(/topic/lobby, /topic/room/{id}, /chat, /speaker, /signal/{me})은 동작한다")
    void allowedSubscriptionsStillWork() throws Exception {
        String roomId = createRoom("h2-host-5", RoomScope.PUBLIC, RoomType.TEMPORARY);
        String token = sessionService.create("h2-host-5").token();

        StompTestClient client = new StompTestClient(port, token);
        try {
            client.subscribe("/topic/lobby");
            client.subscribe("/topic/room/" + roomId);
            client.subscribe("/topic/room/" + roomId + "/chat");
            client.subscribe("/topic/room/" + roomId + "/speaker");
            client.subscribe("/topic/room/" + roomId + "/signal/h2-host-5");
            assertNull(client.tryPoll(500), "허용 구독은 ERROR 를 받지 않는다");

            // 허용 구독이 실제로 이벤트를 수신하는지 확인
            mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                            .header("Authorization", tokenFor("h2-joiner-5"))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new JoinRequest("h2-joiner-5"))))
                    .andExpect(status().isOk());
            String event = client.await(3);
            assertNotNull(event, "허용된 방 토픽 구독은 이벤트를 수신한다");
            assertTrue(event.contains("MEMBER_JOIN"));
        } finally {
            client.close();
        }
    }

    // ---------- H3: chat / signal ----------

    @Test
    @DisplayName("T-H3-01: 비멤버 채팅은 브로드캐스트도 저장도 되지 않는다")
    void nonMemberChatIsDropped() throws Exception {
        String roomId = createRoom("h3-host-1", RoomScope.PUBLIC, RoomType.PERMANENT);
        String hostToken = sessionService.create("h3-host-1").token();

        StompTestClient listener = new StompTestClient(port, hostToken);
        try {
            listener.subscribe("/topic/room/" + roomId + "/chat");

            StompTestClient outsider = new StompTestClient(port, sessionService.create("h3-outsider-1").token());
            try {
                outsider.send("/app/room/" + roomId + "/chat",
                        "{\"clientRequestId\":\"req-outsider\",\"content\":\"intruder\"}");
            } finally {
                outsider.close();
            }

            assertNull(listener.tryPoll(700), "비멤버 메시지는 구독자에게 전달되지 않는다");
        } finally {
            listener.close();
        }

        assertTrue(permanentRoomChatRepository.findRecentMessages(roomId, 50).isEmpty(), "비멤버 메시지는 저장되지 않는다");
        assertEquals(0L, redis.opsForList().size("room:" + roomId + ":messages"), "Redis 캐시에도 저장되지 않는다");

        // 멤버는 정상 전송된다
        StompTestClient memberListener = new StompTestClient(port, hostToken);
        try {
            memberListener.subscribe("/topic/room/" + roomId + "/chat");
            memberListener.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-member\",\"content\":\"hello\"}");
            String received = memberListener.await(3);
            assertNotNull(received, "멤버 메시지는 브로드캐스트된다");
            assertTrue(received.contains("req-member"));
        } finally {
            memberListener.close();
        }
        assertEquals(1, permanentRoomChatRepository.findRecentMessages(roomId, 50).size(), "멤버 메시지는 저장된다");
    }

    @Test
    @DisplayName("T-H3-02: 비멤버 시그널은 타겟에게 중계되지 않는다")
    void nonMemberSignalIsNotRelayed() throws Exception {
        String roomId = createRoom("h3-host-2", RoomScope.PUBLIC, RoomType.TEMPORARY);
        join(roomId, "h3-target-2");

        StompTestClient target = new StompTestClient(port, sessionService.create("h3-target-2").token());
        StompTestClient outsider = new StompTestClient(port, sessionService.create("h3-outsider-2").token());
        try {
            target.subscribe("/topic/room/" + roomId + "/signal/h3-target-2");
            outsider.send("/app/room/" + roomId + "/signal",
                    "{\"to\":\"h3-target-2\",\"type\":\"OFFER\",\"sdp\":\"v=0\"}");

            assertNull(target.tryPoll(700), "비멤버 시그널은 타겟에게 전달되지 않는다");

            // 멤버 발신자는 정상 중계
            StompTestClient member = new StompTestClient(port, sessionService.create("h3-host-2").token());
            try {
                member.send("/app/room/" + roomId + "/signal",
                        "{\"to\":\"h3-target-2\",\"type\":\"OFFER\",\"sdp\":\"v=0\"}");
                String received = target.await(3);
                assertNotNull(received, "멤버 시그널은 타겟에게 중계된다");
                assertTrue(received.contains("\"from\":\"h3-host-2\""));
            } finally {
                member.close();
            }
        } finally {
            target.close();
            outsider.close();
        }
    }
}
