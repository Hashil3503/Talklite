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

    @Test
    @DisplayName("P0-04: 정원 7 초과 방 생성 시 400 Bean Validation 차단")
    void capacityAboveSixRejected() throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(
                "Capacity Game", List.of("cap"), 7,
                RoomScope.PUBLIC, RoomType.TEMPORARY, "cap-host-over");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("cap-host-over"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("P0-04: 정원 1 미만 방 생성 시 400 Bean Validation 차단")
    void capacityBelowTwoRejected() throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(
                "Capacity Game", List.of("cap"), 1,
                RoomScope.PUBLIC, RoomType.TEMPORARY, "cap-host-under");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("cap-host-under"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("P0-03: title 입력 시 원문 유지, 미입력 시 [게임명] 파티 기본값 자동 부여")
    void titleResolutionOnCreate() throws Exception {
        // title 명시 — 그대로 유지
        CreateRoomRequest withTitle = new CreateRoomRequest(
                "다이아 승급전 구합니다",
                "League of Legends",
                List.of("rank"),
                4,
                RoomScope.PUBLIC,
                RoomType.TEMPORARY,
                "title-host-1");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("title-host-1"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(withTitle)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("다이아 승급전 구합니다"));

        // title 미입력 (6-arg 하위 호환 생성자) — [게임명] 파티 기본값
        CreateRoomRequest withoutTitle = new CreateRoomRequest(
                "Valorant", List.of("rank"), 4, RoomScope.PUBLIC, RoomType.TEMPORARY, "title-host-2");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("title-host-2"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(withoutTitle)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("[Valorant] 파티"));
    }

    @Test
    @DisplayName("P0-03: 게임명 60자 초과 시 기본값 [게임명] 파티를 50자로 truncate")
    void titleDefaultTruncatedToFifty() throws Exception {
        String longGame = "G".repeat(60);
        // title 미입력 (6-arg 하위 호환 생성자) — 기본값 "[GGGG...] 파티" 66자 → 50자 절단
        CreateRoomRequest req = new CreateRoomRequest(
                longGame, List.of("t"), 4, RoomScope.PUBLIC, RoomType.TEMPORARY, "trunc-host");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("trunc-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("[" + "G".repeat(49)));
    }

    @Test
    @DisplayName("P0-03: 50자 초과 title 입력 시 Bean Validation 400 거부")
    void titleOverFiftyRejected() throws Exception {
        String longTitle = "A".repeat(51);
        CreateRoomRequest req = new CreateRoomRequest(
                longTitle, "Reject Game", List.of("t"), 4, RoomScope.PUBLIC, RoomType.TEMPORARY, "reject-host");
        mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("reject-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }
}
