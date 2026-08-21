package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class KickApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String createRoom() throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Kick Game", List.of("kick-tag"), 5,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, "host-k"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class).id();
    }

    private void join(String roomId, String user) throws Exception {
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T-07a: 방장이 임시 강퇴하면 멤버 즉시 제거 + 재입장 시 403 user_banned")
    void hostTemporaryKickRemovesAndBlocks() throws Exception {
        String roomId = createRoom();
        join(roomId, "user-a");
        join(roomId, "user-b");

        // 방장 H가 B를 TEMPORARY 강퇴
        mockMvc.perform(post("/api/rooms/" + roomId + "/kick")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new KickRequest(
                                "host-k", "user-b", KickType.TEMPORARY))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.members", not(org.hamcrest.Matchers.hasItem("user-b"))));

        // 임시 밴된 B 재입장 → 403 user_banned
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-b"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("user_banned"));
    }

    @Test
    @DisplayName("T-07b: 비방장 멤버 강퇴 시도 → 403 unauthorized_host")
    void nonHostKickRejected() throws Exception {
        String roomId = createRoom();
        join(roomId, "user-a");
        join(roomId, "user-b");

        mockMvc.perform(post("/api/rooms/" + roomId + "/kick")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new KickRequest(
                                "user-a", "user-b", KickType.PERMANENT))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("unauthorized_host"));
    }

    @Test
    @DisplayName("T-07c: 방장이 본인 강퇴 시도 → 400 invalid_kick")
    void hostKickSelfRejected() throws Exception {
        String roomId = createRoom();
        join(roomId, "user-a");

        mockMvc.perform(post("/api/rooms/" + roomId + "/kick")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new KickRequest(
                                "host-k", "host-k", KickType.PERMANENT))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_kick"));
    }

    @Test
    @DisplayName("T-07d: 영구 강퇴 유저도 재입장 시 403 차단")
    void permanentKickBlocksRejoin() throws Exception {
        String roomId = createRoom();
        join(roomId, "user-a");

        mockMvc.perform(post("/api/rooms/" + roomId + "/kick")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new KickRequest(
                                "host-k", "user-a", KickType.PERMANENT))))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-a"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("user_banned"));
    }
}
