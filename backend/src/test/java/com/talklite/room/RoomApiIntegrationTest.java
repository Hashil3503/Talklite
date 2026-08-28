package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionService;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class RoomApiIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("방 생성, 조회, 입장, 퇴장 전체 흐름 테스트")
    void testRoomLifecycle() throws Exception {
        CreateRoomRequest createRequest = new CreateRoomRequest(
                "Apex Legends",
                List.of("trio", "fps"),
                3,
                RoomScope.PUBLIC,
                RoomType.TEMPORARY,
                "user-host-1"
        );

        // 1. 방 생성
        String responseContent = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("user-host-1"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.game").value("Apex Legends"))
                .andExpect(jsonPath("$.capacity").value(3))
                .andExpect(jsonPath("$.type").value("TEMPORARY"))
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.members[0]").value("user-host-1"))
                .andReturn().getResponse().getContentAsString();

        RoomResponse createdRoom = objectMapper.readValue(responseContent, RoomResponse.class);
        String roomId = createdRoom.id();

        // 2. 방 조회
        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(roomId))
                .andExpect(jsonPath("$.host").value("user-host-1"));

        // 3. 유저 입장
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor("user-guest-2"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-guest-2"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(2));

        // 4. 유저 퇴장
        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("user-guest-2"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-guest-2"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1));
    }
}
