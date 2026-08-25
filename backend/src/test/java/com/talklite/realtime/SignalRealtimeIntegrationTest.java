package com.talklite.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.JoinRequest;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class SignalRealtimeIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RoomMapper roomMapper;

    @LocalServerPort
    private int port;

    private SessionResponse createSession(String user) throws Exception {
        String json = mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new SessionRequest(user))))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, SessionResponse.class);
    }

    private String createRoom(String game, String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                game, List.of("vc"), 8,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class).id();
    }

    private void join(String roomId, String user) throws Exception {
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T-10: OFFER 시그널이 타겟 유저 개인 토픽(/signal/{targetId})으로만 중계된다 (FR-VOICE-02)")
    void offerRelaysToTargetOnly() throws Exception {
        SessionResponse sender = createSession("sig-user-a");
        SessionResponse target = createSession("sig-user-b");
        String roomId = createRoom("Signal Game", "sig-user-a");
        join(roomId, "sig-user-b");

        StompTestClient targetClient = new StompTestClient(port, target.token());
        StompTestClient senderClient = new StompTestClient(port, sender.token());
        targetClient.subscribe("/topic/room/" + roomId + "/signal/sig-user-b");
        senderClient.subscribe("/topic/room/" + roomId + "/signal/sig-user-a");

        senderClient.send("/app/room/" + roomId + "/signal",
                "{\"to\":\"sig-user-b\",\"type\":\"OFFER\",\"sdp\":\"v=0\\r\\no=- 1 2 IN IP4 0.0.0.0\"}");

        String received = targetClient.await(3);
        assertNotNull(received, "타겟 유저는 Offer를 수신한다");
        assertTrue(received.contains("\"from\":\"sig-user-a\""), "from은 Principal 기반");
        assertTrue(received.contains("\"type\":\"OFFER\""), "시그널 타입 보존");
        assertTrue(received.contains("\"to\":\"sig-user-b\""), "to 보존");

        String leak = senderClient.tryPoll(500);
        assertTrue(leak == null, "비타겟 유저의 토픽으로는 누출되지 않는다");

        targetClient.close();
        senderClient.close();
    }

    @Test
    @DisplayName("T-10b: 발화 상태가 /topic/room/{id}/speaker 로 브로드캐스트된다 (FR-VOICE-03)")
    void speakerBroadcastsToRoom() throws Exception {
        SessionResponse speaker = createSession("spk-a");
        String roomId = createRoom("Speaker Game", "spk-a");

        StompTestClient listener = new StompTestClient(port, speaker.token());
        listener.subscribe("/topic/room/" + roomId + "/speaker");

        listener.send("/app/room/" + roomId + "/speaker", "{\"talking\":true}");

        String received = listener.await(3);
        assertNotNull(received, "발화 상태 이벤트 수신");
        assertTrue(received.contains("\"speakerId\":\"spk-a\""), "speakerId는 Principal 기반");
        assertTrue(received.contains("\"talking\":true"), "발화 상태 보존");
        listener.close();
    }

    @Test
    @DisplayName("T-10c: 음성 참여는 최대 6인까지 허용되고 VOICE_STATUS_CHANGED에 voiceMembers가 포함된다 (FR-VOICE-01)")
    void voiceCapacityGuardAndVoiceMembers() throws Exception {
        List<SessionResponse> sessions = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            sessions.add(createSession("vc-user-" + i));
        }
        String roomId = createRoom("Capacity Game", "vc-user-1");

        StompTestClient observer = new StompTestClient(port, sessions.get(0).token());
        observer.subscribe("/topic/room/" + roomId);

        for (int i = 0; i < 7; i++) {
            StompTestClient client = new StompTestClient(port, sessions.get(i).token());
            client.send("/app/room/" + roomId + "/voice/start", "{}");
            client.close();
        }

        // 6인 상한 가드 확인 (7번째 참여 거부)
        assertEquals(6, roomMapper.voiceCount(roomId), "음성 참여자는 6명을 초과할 수 없다");

        // VOICE_STATUS_CHANGED 이벤트에 voiceMembers 목록 포함 (Mesh 협상용)
        boolean sawVoiceMembers = false;
        for (int i = 0; i < 8; i++) {
            String frame = observer.await(2);
            if (frame == null) {
                break;
            }
            if (frame.contains("\"voiceMembers\":[\"vc-user-1\",\"vc-user-2\",\"vc-user-3\",\"vc-user-4\",\"vc-user-5\",\"vc-user-6\"]")) {
                sawVoiceMembers = true;
            }
        }
        assertTrue(sawVoiceMembers, "VOICE_STATUS_CHANGED에 voiceMembers 목록이 포함된다");
        observer.close();
    }
}
