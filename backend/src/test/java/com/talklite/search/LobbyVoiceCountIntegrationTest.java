package com.talklite.search;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.voice.VoiceService;
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

/**
 * T-H10: 방 목록(검색) 응답이 로비 보이스 배지에 필요한 voiceCount를 포함한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
public class LobbyVoiceCountIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private VoiceService voiceService;

    @Test
    @DisplayName("T-H10: 음성 참여 후 검색/조회 응답의 voiceCount가 갱신된다")
    void searchResponseIncludesVoiceCount() throws Exception {
        String host = "voice-count-host";
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "Voice Count Game", List.of("vcount"), 6,
                                RoomScope.PUBLIC, RoomType.TEMPORARY, host))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.voiceCount").value(0))
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(json, RoomResponse.class).id();

        voiceService.start(roomId, host);

        // 로비 목록 응답
        mockMvc.perform(get("/api/search").param("tags", "vcount"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + roomId + "')].voiceCount").value(1));

        // 단일 방 조회 응답
        mockMvc.perform(get("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.voiceCount").value(1));
    }
}
