package com.talklite.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.JoinRequest;
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

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class ChatRealtimeIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @org.springframework.boot.test.web.server.LocalServerPort
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
                                game, List.of("evt"), 5,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class).id();
    }

    @Test
    @DisplayName("T-08: STOMP 채팅 전송 → Redis Pub/Sub Relay → 구독 클라이언트 실시간 수신 & clientRequestId 에코, sender는 Principal")
    void chatRelaysToRoomTopicWithPrincipalSender() throws Exception {
        SessionResponse session = createSession("user-a");
        String roomId = createRoom("STOMP Game", "user-a");

        StompTestClient listener = new StompTestClient(port, session.token());
        listener.subscribe("/topic/room/" + roomId + "/chat");
        listener.send("/app/room/" + roomId + "/chat",
                "{\"clientRequestId\":\"req-1\",\"content\":\"hello\"}");

        String received = listener.await(3);
        assertTrue(received != null, "구독 클라이언트는 채팅 메시지를 수신한다");
        assertTrue(received.contains("\"clientRequestId\":\"req-1\""), "clientRequestId 에코 포함");
        assertTrue(received.contains("\"sender\":\"user-a\""), "sender는 Principal 기반 user-a");
        listener.close();
    }

    @Test
    @DisplayName("T-08b: 방 입장 이벤트가 /topic/room/{id} 로 실시간 수신된다 (FR-RT-01)")
    void roomEventsRelayBroadcast() throws Exception {
        SessionResponse session = createSession("host-b");
        String roomId = createRoom("Lobby Game", "host-b");

        StompTestClient listener = new StompTestClient(port, session.token());
        listener.subscribe("/topic/room/" + roomId);

        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("joiner-b"))))
                .andExpect(status().isOk());

        String event = listener.await(3);
        assertTrue(event != null && event.contains("\"type\":\"MEMBER_JOIN\""), "입장 이벤트가 Pub/Sub → STOMP 로 전파된다");
        listener.close();
    }
}
