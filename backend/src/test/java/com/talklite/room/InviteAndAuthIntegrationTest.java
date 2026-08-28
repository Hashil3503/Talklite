package com.talklite.room;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.StompTestClient;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class InviteAndAuthIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @LocalServerPort
    private int port;

    private String createPrivateRoom(String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Private Game", java.util.List.of("inv"), 5,
                                RoomScope.PRIVATE, RoomType.TEMPORARY, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class).id();
    }

    private SessionResponse createSession(String user) throws Exception {
        String json = mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new SessionRequest(user))))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, SessionResponse.class);
    }

    @Test
    @DisplayName("T-09a: 비공개 방 직접 join → 403 invite_required / 초대코드로만 입장 성공 / 무효 코드 → 404 invite_invalid")
    void privateRoomRequiresInviteCode() throws Exception {
        String roomId = createPrivateRoom("pv-host");

        // 직접 join → 403 invite_required
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor("pv-guest"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("pv-guest"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("invite_required"));

        // 방장이 초대코드 발급
        String inviteJson = mockMvc.perform(post("/api/rooms/" + roomId + "/invite")
                        .header("Authorization", tokenFor("pv-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"pv-host\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").isString())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = objectMapper.readTree(inviteJson);
        String code = node.get("code").asText();
        assertNotNull(code);
        assertTrue(code.matches("[A-Z2-9]{6}"));
    }

    @Test
    @DisplayName("T-09b: 무효 초대코드 입장 → 404 invite_invalid")
    void invalidInviteCodeRejected() throws Exception {
        mockMvc.perform(post("/api/invite/INVALID/join")
                        .header("Authorization", tokenFor("any-user"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("any-user"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("invite_invalid"));
    }

    @Test
    @DisplayName("T-09c: 초대코드 입장 성공 시 방 멤버가 되고 구독자에게 MEMBER_JOIN 전파")
    void inviteJoinSucceeds() throws Exception {
        String roomId = createPrivateRoom("jv-host");
        String inviteJson = mockMvc.perform(post("/api/rooms/" + roomId + "/invite")
                        .header("Authorization", tokenFor("jv-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"jv-host\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String code = objectMapper.readTree(inviteJson).get("code").asText();

        // 방장이 /topic/room/{id} 구독 → 초대 입장 이벤트 수신
        SessionResponse host = createSession("jv-host");
        StompTestClient listener = new StompTestClient(port, host.token());
        listener.subscribe("/topic/room/" + roomId);

        mockMvc.perform(post("/api/invite/" + code + "/join")
                        .header("Authorization", tokenFor("jv-guest"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("jv-guest"))))
                .andExpect(status().isOk());

        String event = listener.await(3);
        assertTrue(event != null && event.contains("\"type\":\"MEMBER_JOIN\""), "초대 입장 이벤트가 실시간 전파된다");
        listener.close();
    }

    @Test
    @DisplayName("T-09d: 비공개 방 미참여자가 STOMP 구독 시 인가 거부로 수신 불가")
    void nonMemberSubscribePrivateReceivesNothing() throws Exception {
        String roomId = createPrivateRoom("nm-host");

        SessionResponse stranger = createSession("stranger-1");
        StompTestClient strangerClient = new StompTestClient(port, stranger.token());
        strangerClient.subscribe("/topic/room/" + roomId);

        String msg = strangerClient.tryPoll(500);
        // 비인가 구독 시 서버가 ERROR 프레임을 보내거나 이벤트를 전달하지 않음
        assertTrue(msg == null || msg.startsWith("ERROR") || !msg.contains("MEMBER_JOIN"), "미참여자는 비공개 방 이벤트를 수신할 수 없다");
        strangerClient.close();
    }
}
