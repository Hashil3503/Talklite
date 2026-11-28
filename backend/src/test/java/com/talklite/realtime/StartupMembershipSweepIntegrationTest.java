package com.talklite.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionResponse;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.JoinRequest;
import com.talklite.room.RoomMapper;
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

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 기동 멤버십 스윕: 서버 재기동 후 live STOMP 세션이 없는 멤버 정리 검증.
 * 스케줄된 스윕은 테스트에서 3600초로 미뤄두고, 스윕 메서드를 직접 호출한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class StartupMembershipSweepIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RoomMapper roomMapper;

    @Autowired
    private RoomSessionRegistry roomSessionRegistry;

    @Autowired
    private StartupMembershipSweeper sweeper;

    @LocalServerPort
    private int port;

    private String createRoom(String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Sweep Game", List.of("sweep"), 4,
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

    /** SUBSCRIBE가 서버에 도착해 live 세션으로 등록될 때까지 대기 */
    private boolean awaitLiveSession(String roomId, String user) throws Exception {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            if (roomSessionRegistry.count(roomId, user) > 0) {
                return true;
            }
            Thread.sleep(100);
        }
        return roomSessionRegistry.count(roomId, user) > 0;
    }

    @Test
    @DisplayName("기동 스윕: live 세션이 없는 REST 전용 멤버는 퇴장 처리되고 TEMPORARY 방은 파기된다")
    void sweepRemovesMembersWithoutLiveSession() throws Exception {
        String roomId = createRoom("sweep-host");
        join(roomId, "sweep-guest");
        assertTrue(roomMapper.members(roomId).contains("sweep-guest"));

        sweeper.sweep();

        assertFalse(roomMapper.members(roomId).contains("sweep-guest"),
                "live STOMP 세션이 없는 멤버는 스윕에서 제거되어야 함");
        assertNull(roomMapper.find(roomId), "마지막 멤버까지 사라지면 TEMPORARY 방은 파기된다");
    }

    @Test
    @DisplayName("기동 스윕: 방 토픽을 구독 중인 live 세션이 있는 멤버는 유지된다")
    void sweepKeepsMembersWithLiveSession() throws Exception {
        SessionResponse guest = sessionService.create("sweep-live-guest");
        String roomId = createRoom("sweep-live-host");
        join(roomId, "sweep-live-guest");

        StompTestClient client = new StompTestClient(port, guest.token());
        try {
            client.subscribe("/topic/room/" + roomId);
            assertTrue(awaitLiveSession(roomId, "sweep-live-guest"),
                    "SUBSCRIBE가 live 세션으로 등록되어야 함");

            sweeper.sweep();

            assertTrue(roomMapper.members(roomId).contains("sweep-live-guest"),
                    "live 세션이 있는 멤버는 스윕에서 유지되어야 함");
            assertNotNull(roomMapper.find(roomId), "멤버가 남아 있으므로 방은 유지된다");
        } finally {
            client.close();
        }
    }
}
