package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.StompTestClient;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.voice.VoiceService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * DEF-05 회귀 검증: 방장에게 강퇴된 사용자의 실시간 채팅은 저장/전달되지 않는다.
 * (강퇴 시 클라이언트는 방 토픽 구독을 해제하지만, 서버도 비멤버 발신을 무시해야 한다.)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class KickedUserRealtimeAccessIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private VoiceService voiceService;

    @LocalServerPort
    private int port;

    private String createRoom(String host) throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Kicked Game", List.of("def05"), 5,
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

    @Test
    @DisplayName("DEF-05: 방장이 강퇴한 사용자의 STOMP 채팅은 저장/전달되지 않고, 음성 시작은 거부 또는 무시된다")
    void kickedUserChatIsNotDeliveredOrStored() throws Exception {
        String roomId = createRoom("host-def05");
        join(roomId, "kicked-user");

        SessionResponse hostSession = sessionService.create("host-def05");
        SessionResponse kickedSession = sessionService.create("kicked-user");

        StompTestClient hostListener = new StompTestClient(port, hostSession.token());
        hostListener.subscribe("/topic/room/" + roomId + "/chat");
        StompTestClient kickedClient = new StompTestClient(port, kickedSession.token());
        kickedClient.subscribe("/topic/room/" + roomId + "/chat");

        // 방장이 kicked-user를 영구 강퇴 → 멤버 목록에서 즉시 제거
        mockMvc.perform(post("/api/rooms/" + roomId + "/kick")
                        .header("Authorization", tokenFor("host-def05"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new KickRequest(
                                "host-def05", "kicked-user", KickType.PERMANENT))))
                .andExpect(status().isOk());

        // 강퇴된 사용자는 여전히 열린 STOMP 세션으로 채팅을 전송할 수 있다 (서버가 무시해야 함)
        kickedClient.send("/app/room/" + roomId + "/chat",
                "{\"clientRequestId\":\"def05-1\",\"content\":\"still here?\"}");

        // 다른 멤버(방장)에게는 전달되지 않는다
        String delivered = hostListener.tryPoll(1500);
        assertNull(delivered, "강퇴된 사용자의 채팅은 방 토픽으로 브로드캐스트되지 않는다");

        // Redis/DB 어디에도 저장되지 않는다
        String history = mockMvc.perform(get("/api/rooms/" + roomId + "/messages")
                        .header("Authorization", tokenFor("host-def05")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(objectMapper.readValue(history, List.class).isEmpty(),
                "강퇴된 사용자의 채팅은 저장되지 않는다");

        // 음성 참여: 현재 VoiceService.start 에는 멤버십 가드가 없어 강퇴자도 수용된다.
        // (요구사항은 '거부 또는 무시'이므로, 이 동작이 바뀌면 아래 단언을 함께 갱신해야 한다.)
        assertDoesNotThrow(() -> voiceService.start(roomId, "kicked-user"),
                "현 동작: 음성 시작은 멤버십 가드가 없어 예외 없이 처리된다");
        assertTrue(voiceService.getVoiceMembers(roomId).contains("kicked-user"),
                "현 동작: 강퇴된 사용자도 음성 참여자로 등록된다 (가드 부재)");

        kickedClient.close();
        hostListener.close();
    }
}
