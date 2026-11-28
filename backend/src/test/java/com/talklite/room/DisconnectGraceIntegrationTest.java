package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.StompTestClient;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-H4: WebSocket 연결 단절 후 유예 시간(테스트 2초) 뒤 방 멤버십 정리 검증.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class DisconnectGraceIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RoomMapper roomMapper;

    @LocalServerPort
    private int port;

    private String createRoom(String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Grace Game", List.of("grace"), 4,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, host))))
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

    private boolean awaitMembershipChange(String roomId, String user, boolean expectMember) throws Exception {
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            if (roomMapper.members(roomId).contains(user) != expectMember) {
                return true;
            }
            Thread.sleep(200);
        }
        return roomMapper.members(roomId).contains(user) != expectMember;
    }

    private boolean awaitRoomGone(String roomId) throws Exception {
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            if (roomMapper.find(roomId) == null) {
                return true;
            }
            Thread.sleep(200);
        }
        return roomMapper.find(roomId) == null;
    }

    /** 방 이벤트 토픽에서 특정 타입/actor 이벤트를 수신할 때까지 대기 */
    private boolean awaitRoomEvent(StompTestClient client, String type, String actor) throws Exception {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            String frame = client.tryPoll(200);
            if (frame != null
                    && frame.contains("\"type\":\"" + type + "\"")
                    && frame.contains("\"actor\":\"" + actor + "\"")) {
                return true;
            }
        }
        return false;
    }

    /** 유예 시간 중 GET /api/rooms/{id} 응답의 offlineMembers에 사용자가 포함되는지 확인 */
    private boolean awaitOfflineMemberInRoomApi(String roomId, String user, String token) throws Exception {
        long deadline = System.currentTimeMillis() + 1_500;
        while (System.currentTimeMillis() < deadline) {
            String json = mockMvc.perform(get("/api/rooms/" + roomId)
                            .header("Authorization", token))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            RoomResponse response = objectMapper.readValue(json, RoomResponse.class);
            if (response.offlineMembers().contains(user)) {
                return true;
            }
        }
        return false;
    }

    @Test
    @DisplayName("T-H4: 연결이 끊긴 멤버가 유예 시간 내 돌아오지 않으면 방에서 제거된다")
    void disconnectedMemberRemovedAfterGrace() throws Exception {
        SessionResponse host = sessionService.create("grace-host");
        SessionResponse guest = sessionService.create("grace-guest");
        String roomId = createRoom("grace-host");
        join(roomId, "grace-guest");

        StompTestClient client = new StompTestClient(port, guest.token());
        client.subscribe("/topic/room/" + roomId);
        client.close();

        assertTrue(awaitMembershipChange(roomId, "grace-guest", false),
                "유예 시간 후 멤버 목록에서 제거되어야 함");
        assertNotNull(roomMapper.find(roomId), "방장이 남아 있으므로 방은 유지된다");
        assertTrue(roomMapper.members(roomId).contains(host.user()), "방장은 그대로 남는다");
    }

    @Test
    @DisplayName("T-H4: 마지막 멤버가 끊긴 채 돌아오지 않으면 임시 방이 파기된다")
    void lastMemberDisconnectDestroysTemporaryRoom() throws Exception {
        SessionResponse host = sessionService.create("grace-solo");
        String roomId = createRoom("grace-solo");

        StompTestClient client = new StompTestClient(port, host.token());
        client.subscribe("/topic/room/" + roomId);
        client.close();

        assertTrue(awaitRoomGone(roomId), "마지막 멤버가 사라지면 TEMPORARY 방은 파기된다");
    }

    @Test
    @DisplayName("T-H4: 유예 시간 내 재접속 후 재구독하면 멤버십이 유지된다")
    void reconnectedMemberKeepsMembership() throws Exception {
        SessionResponse guest = sessionService.create("grace-back");
        String roomId = createRoom("grace-back-host");
        join(roomId, "grace-back");

        StompTestClient first = new StompTestClient(port, guest.token());
        first.subscribe("/topic/room/" + roomId);
        first.close();
        Thread.sleep(500); // 단절 이벤트(카운트 감소) 처리 대기

        StompTestClient second = new StompTestClient(port, guest.token());
        try {
            second.subscribe("/topic/room/" + roomId);
            Thread.sleep(4_000); // 테스트 유예 시간(2초)의 두 배 대기
            assertTrue(roomMapper.members(roomId).contains("grace-back"),
                    "유예 시간 내 재구독한 멤버는 제거되지 않는다");
        } finally {
            second.close();
        }
    }

    @Test
    @DisplayName("연결이 끊긴 구독자에게 MEMBER_OFFLINE 이벤트가 발행된다")
    void disconnectPublishesMemberOffline() throws Exception {
        SessionResponse guest = sessionService.create("offline-guest");
        SessionResponse host = sessionService.create("offline-host");
        String roomId = createRoom("offline-host");
        join(roomId, "offline-guest");

        StompTestClient observer = new StompTestClient(port, host.token());
        try {
            observer.subscribe("/topic/room/" + roomId);

            StompTestClient client = new StompTestClient(port, guest.token());
            client.subscribe("/topic/room/" + roomId);
            client.close();

            assertTrue(awaitRoomEvent(observer, "MEMBER_OFFLINE", "offline-guest"),
                    "구독자가 끊기면 방 이벤트로 MEMBER_OFFLINE이 전파되어야 함");
        } finally {
            observer.close();
        }
    }

    @Test
    @DisplayName("유예 시간 내 재구독하면 MEMBER_ONLINE 이벤트가 발행된다")
    void reconnectPublishesMemberOnline() throws Exception {
        SessionResponse guest = sessionService.create("online-guest");
        SessionResponse host = sessionService.create("online-host");
        String roomId = createRoom("online-host");
        join(roomId, "online-guest");

        StompTestClient observer = new StompTestClient(port, host.token());
        StompTestClient first = new StompTestClient(port, guest.token());
        StompTestClient second = new StompTestClient(port, guest.token());
        try {
            observer.subscribe("/topic/room/" + roomId);
            first.subscribe("/topic/room/" + roomId);

            first.close();
            assertTrue(awaitRoomEvent(observer, "MEMBER_OFFLINE", "online-guest"),
                    "단절 시 OFFLINE 이벤트가 발행된다");

            second.subscribe("/topic/room/" + roomId);
            assertTrue(awaitRoomEvent(observer, "MEMBER_ONLINE", "online-guest"),
                    "유예 시간 내 재구독하면 ONLINE 이벤트가 다시 발행된다");
            assertTrue(roomMapper.members(roomId).contains("online-guest"),
                    "유예 시간 내 재구독한 멤버는 제거되지 않는다");
        } finally {
            first.close();
            second.close();
            observer.close();
        }
    }

    @Test
    @DisplayName("유예 시간 중 GET /api/rooms/{id} 응답의 offlineMembers에 대상 사용자가 포함된다")
    void roomApiListsMemberAsOfflineDuringGrace() throws Exception {
        String hostToken = tokenFor("api-host");
        SessionResponse guest = sessionService.create("api-guest");
        String roomId = createRoom("api-host");
        join(roomId, "api-guest");

        StompTestClient client = new StompTestClient(port, guest.token());
        try {
            client.subscribe("/topic/room/" + roomId);
            assertFalse(readRoom(roomId, hostToken).offlineMembers().contains("api-guest"),
                    "방 토픽을 구독 중인 멤버는 connected로 조회된다");
        } finally {
            client.close();
        }

        assertTrue(awaitOfflineMemberInRoomApi(roomId, "api-guest", hostToken),
                "유예 시간 중에는 offlineMembers에 포함되어 연결 끊김으로 표시된다");

        assertTrue(awaitMemberRemoved(roomId, "api-guest"),
                "유예 시간이 지나면 멤버십에서 제거된다");
        assertFalse(readRoom(roomId, hostToken).offlineMembers().contains("api-guest"),
                "제거된 사용자는 offlineMembers에도 남지 않는다");
    }

    private boolean awaitMemberRemoved(String roomId, String user) throws Exception {
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            if (!roomMapper.members(roomId).contains(user)) {
                return true;
            }
            Thread.sleep(200);
        }
        return !roomMapper.members(roomId).contains(user);
    }

    private RoomResponse readRoom(String roomId, String token) throws Exception {
        String json = mockMvc.perform(get("/api/rooms/" + roomId)
                        .header("Authorization", token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class);
    }
}
