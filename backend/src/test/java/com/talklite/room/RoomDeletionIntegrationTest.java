package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class RoomDeletionIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PermanentRoomRepository permanentRoomRepository;

    private final List<String> createdRooms = new ArrayList<>();

    @AfterEach
    void purge() {
        for (String roomId : createdRooms) {
            permanentRoomRepository.delete(roomId);
            for (String key : List.of(
                    "room:" + roomId + ":meta",
                    "room:" + roomId + ":members",
                    "room:" + roomId + ":joined_at",
                    "room:" + roomId + ":voice",
                    "room:" + roomId + ":banned",
                    "room:" + roomId + ":invite")) {
                redis.delete(key);
            }
            for (String key : redis.keys("room:" + roomId + ":banned:*")) {
                redis.delete(key);
            }
            redis.opsForSet().remove("game:overwatch:rooms", roomId);
            redis.opsForSet().remove("tag:competitive:rooms", roomId);
            redis.opsForSet().remove("tag:tier-gold:rooms", roomId);
        }
        createdRooms.clear();
    }

    @Test
    @DisplayName("T-10-1: 방장 전용 영구 방 명시적 삭제 — MariaDB 및 Redis 일괄 소멸 검증")
    void testHostExplicitPermanentRoomDeletion() throws Exception {
        // 1. 영구 방 생성
        CreateRoomRequest request = new CreateRoomRequest(
                "Overwatch",
                List.of("Competitive", "tier-gold"),
                5,
                RoomScope.PUBLIC,
                RoomType.PERMANENT,
                "host-admin"
        );
        String createRes = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        RoomResponse room = objectMapper.readValue(createRes, RoomResponse.class);
        String roomId = room.id();
        createdRooms.add(roomId);

        // 생성 직후 DB 및 Redis 검증
        assertTrue(permanentRoomRepository.findById(roomId).isPresent(), "MariaDB에 영구 방이 저장되어 있어야 함");
        assertEquals(Boolean.TRUE, redis.hasKey("room:" + roomId + ":meta"), "Redis meta 키가 존재해야 함");
        assertTrue(redis.opsForSet().isMember("game:overwatch:rooms", roomId), "game 역색인에 포함되어야 함");

        // 2. 방장 권한으로 DELETE /api/rooms/{id} 요청
        DeleteRoomRequest deleteRequest = new DeleteRoomRequest("host-admin");
        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(deleteRequest)))
                .andExpect(status().isNoContent());

        // 3. 삭제 후 MariaDB 및 Redis 완전 소멸 검증
        assertTrue(permanentRoomRepository.findById(roomId).isEmpty(), "MariaDB에서 영구 방 레코드가 완전히 삭제되어야 함");
        assertEquals(Boolean.FALSE, redis.hasKey("room:" + roomId + ":meta"), "Redis meta 키가 삭제되어야 함");
        assertEquals(Boolean.FALSE, redis.hasKey("room:" + roomId + ":members"), "Redis members 키가 삭제되어야 함");
        assertFalse(redis.opsForSet().isMember("game:overwatch:rooms", roomId), "game 역색인에서 제거되어야 함");
        assertFalse(redis.opsForSet().isMember("tag:competitive:rooms", roomId), "tag 역색인에서 제거되어야 함");

        // 4. GET /api/rooms/{id} 조회 시 404 확인
        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("room_not_found"));
    }

    @Test
    @DisplayName("T-10-2: 비방장의 방 삭제 시도 시 403 Forbidden 차단 검증")
    void testNonHostCannotDeleteRoom() throws Exception {
        CreateRoomRequest request = new CreateRoomRequest(
                "Overwatch",
                List.of("Competitive"),
                4,
                RoomScope.PUBLIC,
                RoomType.PERMANENT,
                "host-owner"
        );
        String createRes = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        RoomResponse room = objectMapper.readValue(createRes, RoomResponse.class);
        String roomId = room.id();
        createdRooms.add(roomId);

        // 일반 유저 guest-user 가 삭제 시도
        DeleteRoomRequest deleteRequest = new DeleteRoomRequest("guest-user");
        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(deleteRequest)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("unauthorized_host"));

        // 방은 여전히 안전하게 유지되어야 함
        assertTrue(permanentRoomRepository.findById(roomId).isPresent());
        assertEquals(Boolean.TRUE, redis.hasKey("room:" + roomId + ":meta"));
    }

    @Test
    @DisplayName("T-10-3: 존재하지 않는 방 삭제 시도 시 404 Not Found 검증")
    void testDeleteNonExistentRoom() throws Exception {
        DeleteRoomRequest deleteRequest = new DeleteRoomRequest("any-user");
        mockMvc.perform(delete("/api/rooms/non-existent-room-id")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(deleteRequest)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("room_not_found"));
    }

    @Test
    @DisplayName("T-10-4: 다중 인원이 존재하는 방을 방장이 폭파할 때 강제 일괄 삭제 검증")
    void testHostDestroysRoomWithMultipleMembers() throws Exception {
        CreateRoomRequest request = new CreateRoomRequest(
                "Overwatch",
                List.of("Competitive"),
                5,
                RoomScope.PUBLIC,
                RoomType.TEMPORARY,
                "host-leader"
        );
        String createRes = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        RoomResponse room = objectMapper.readValue(createRes, RoomResponse.class);
        String roomId = room.id();
        createdRooms.add(roomId);

        // 멤버 2명 추가 입장
        mockMvc.perform(post("/api/rooms/" + roomId + "/members/member-1")).andExpect(status().isOk());
        mockMvc.perform(post("/api/rooms/" + roomId + "/members/member-2")).andExpect(status().isOk());
        assertEquals(3, redis.opsForSet().size("room:" + roomId + ":members"));

        // 방장이 폭파 실행 (SCARD > 0 임에도 destroy.lua 로 강제 파기되어야 함)
        DeleteRoomRequest deleteRequest = new DeleteRoomRequest("host-leader");
        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(deleteRequest)))
                .andExpect(status().isNoContent());

        // 모든 데이터 소멸 확인
        assertEquals(Boolean.FALSE, redis.hasKey("room:" + roomId + ":meta"));
        assertEquals(Boolean.FALSE, redis.hasKey("room:" + roomId + ":members"));
        assertEquals(Boolean.FALSE, redis.hasKey("room:" + roomId + ":joined_at"));

        // 삭제된 방에 신규 유저 입장 시도 시 404 차단
        mockMvc.perform(post("/api/rooms/" + roomId + "/members/late-user"))
                .andExpect(status().isNotFound());
    }
}