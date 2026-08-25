package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class HostMigrationIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("T-04: 방장 퇴장 시 가입 시각이 가장 빠른 유저에게 호스트 자동 위임")
    void hostMigratesToOldestMemberOnLeave() throws Exception {
        // H(방장)가 방 생성, A 입장(t1), B 입장(t2, t2>t1)
        String createContent = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Migrate Game", List.of("host-m"), 3,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, "host-mig"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(createContent, RoomResponse.class).id();

        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-a"))))
                .andExpect(status().isOk());
        Thread.sleep(5);
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("user-b"))))
                .andExpect(status().isOk());

        // 방장 H 퇴장 → host가 "user-a"로 위임, H는 멤버에서 제거
        String after = mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("host-mig"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.host").value("user-a"))
                .andReturn().getResponse().getContentAsString();

        RoomResponse room = objectMapper.readValue(after, RoomResponse.class);
        assertEquals("user-a", room.host());
        assertFalse(room.members().contains("host-mig"), "퇴장한 방장은 멤버에서 제거되어야 한다");
    }
}
