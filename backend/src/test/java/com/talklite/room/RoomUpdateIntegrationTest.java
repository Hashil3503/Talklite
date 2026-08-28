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
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class RoomUpdateIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String createRoom(String host, String game, List<String> tags, int capacity, RoomType type) throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(game, tags, capacity, RoomScope.PUBLIC, type, host);
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(content).get("id").asText();
    }

    @Test
    @DisplayName("PATCH 정상 갱신 — 방장이 title/game/tags/capacity 수정 시 200 및 조회 반영")
    void hostCanUpdateRoom() throws Exception {
        String host = "update-host-1";
        String roomId = createRoom(host, "Overwatch", List.of("oldtag", "fps"), 4, RoomType.PERMANENT);

        Map<String, Object> patch = Map.of(
                "title", "다이아 랭크 즐겜팟 (수정됨)",
                "game", "리그 오브 레전드",
                "tags", List.of("자랭", "다이아", "보이스필수"),
                "capacity", 5
        );

        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.game").value("리그 오브 레전드"))
                .andExpect(jsonPath("$.capacity").value(5));

        // GET으로 재조회 시 반영 확인
        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.game").value("리그 오브 레전드"))
                .andExpect(jsonPath("$.capacity").value(5));
    }

    @Test
    @DisplayName("PATCH 403 — 비방장이 수정 시도시 차단")
    void nonHostCannotUpdate() throws Exception {
        String host = "update-host-2";
        String guest = "update-guest-2";
        String roomId = createRoom(host, "Valorant", List.of("rank"), 4, RoomType.TEMPORARY);
        // guest 입장
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor(guest))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(guest))))
                .andExpect(status().isOk());

        Map<String, Object> patch = Map.of("game", "Hacked", "capacity", 6);
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(guest))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("PATCH 409 — 현재 인원보다 작은 정원으로 축소 시 충돌 차단")
    void capacityConflictReturns409() throws Exception {
        String host = "update-host-3";
        String roomId = createRoom(host, "Apex", List.of("conflict"), 4, RoomType.TEMPORARY);
        // 2명 추가 입장 → 총 3명
        for (String guest : List.of("guest-a3", "guest-b3")) {
            mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                            .header("Authorization", tokenFor(guest))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new JoinRequest(guest))))
                    .andExpect(status().isOk());
        }

        Map<String, Object> patch = Map.of("capacity", 2);
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("room_capacity_conflict"));
    }

    @Test
    @DisplayName("PATCH 태그 재색인 — 수정 후 신규 태그 검색 노출, 이전 태그 제외")
    void tagReindexSearchVerification() throws Exception {
        String host = "update-host-4";
        String roomId = createRoom(host, "TagGame", List.of("oldtag-xyz", "fps"), 4, RoomType.TEMPORARY);

        // 초기 oldtag 검색 노출 확인
        mockMvc.perform(get("/api/search").param("tags", "oldtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + roomId + "')]").exists());

        Map<String, Object> patch = Map.of("tags", List.of("newtag-xyz", "fps"));
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isOk());

        // newtag 검색 시 노출
        mockMvc.perform(get("/api/search").param("tags", "newtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + roomId + "')]").exists());

        // oldtag 검색 시 제외
        mockMvc.perform(get("/api/search").param("tags", "oldtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + roomId + "')]").doesNotExist());
    }
}
