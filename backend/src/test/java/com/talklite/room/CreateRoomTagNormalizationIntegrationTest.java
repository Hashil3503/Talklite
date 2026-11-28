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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-H12: 방 생성 태그도 수정(PATCH)과 동일하게 정규화(trim + 소문자 + 중복 제거) 후 5개 초과만 거부한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
public class CreateRoomTagNormalizationIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("T-H12: 6개 태그가 중복/대소문자/공백으로 5개 이하로 접히면 200 + 정규화된 태그 반환")
    void duplicateTagsCollapsingUnderLimitAreAccepted() throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(
                "Tag Game", List.of("FPS", "fps", " Fps ", "rank", "RANK", "rank"),
                4, RoomScope.PUBLIC, RoomType.TEMPORARY, "tag-host-ok");

        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("tag-host-ok"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tags.length()").value(2))
                .andReturn().getResponse().getContentAsString();

        RoomResponse created = objectMapper.readValue(content, RoomResponse.class);
        assertEquals(List.of("fps", "rank"), created.tags(), "소문자 정규화 + 중복 제거");
    }

    @Test
    @DisplayName("T-H12: 정규화 후에도 6개 이상인 태그는 400 invalid_request")
    void moreThanFiveDistinctTagsRejected() throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(
                "Tag Game", List.of("a1", "b2", "c3", "d4", "e5", "f6"),
                4, RoomScope.PUBLIC, RoomType.TEMPORARY, "tag-host-reject");

        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("tag-host-reject"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_request"));
    }
}
