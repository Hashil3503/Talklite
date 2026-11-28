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

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
}
