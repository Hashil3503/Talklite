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
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class PermanentRoomPersistenceIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private PermanentRoomRepository permanentRoomRepository;

    @Autowired
    private RoomRehydrator roomRehydrator;

    private final List<String> createdRooms = new ArrayList<>();

    @AfterEach
    void cleanup() {
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
        }
        createdRooms.clear();
    }

    private String createRoom(String game, List<String> tags, int capacity, RoomScope scope, RoomType type, String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(game, tags, capacity, scope, type, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String id = objectMapper.readValue(json, RoomResponse.class).id();
        createdRooms.add(id);
        return id;
    }

    @Test
    @DisplayName("T-06: 영구 방 생성 시 MariaDB 저장, 방장 승계 DB 동기화, Redis 삭제 후 Rehydrator 복원 검증")
    void permanentRoomPersistenceAndRehydrationFlow() throws Exception {
        String roomId = createRoom("StarCraft", List.of("clan", "ladder"), 6, RoomScope.PUBLIC, RoomType.PERMANENT, "initial-host");

        Optional<Room> savedInDb = permanentRoomRepository.findById(roomId);
        assertTrue(savedInDb.isPresent(), "MariaDB에 저장되어야 함");
        assertEquals("initial-host", savedInDb.get().host());
        assertEquals("StarCraft", savedInDb.get().game());
        assertTrue(savedInDb.get().tags().contains("clan"));

        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor("second-user"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("second-user"))))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("initial-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("initial-host"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.host").value("second-user"));

        Optional<Room> updatedInDb = permanentRoomRepository.findById(roomId);
        assertTrue(updatedInDb.isPresent());
        assertEquals("second-user", updatedInDb.get().host(), "HostMigration 발생 시 MariaDB host도 갱신되어야 함");

        redis.delete("room:" + roomId + ":meta");
        redis.delete("room:" + roomId + ":members");
        redis.opsForSet().remove("game:starcraft:rooms", roomId);
        redis.opsForSet().remove("tag:clan:rooms", roomId);

        roomRehydrator.rehydrate();

        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.host").value("second-user"))
                .andExpect(jsonPath("$.count").value(0));

        mockMvc.perform(get("/api/search?game=StarCraft"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(roomId));
    }

    @Test
    @DisplayName("P0-03: title 영속화 — DB 저장 + Redis 재기동(rehydrate) 후 복원")
    void titlePersistedAndRestoredAfterRehydration() throws Exception {
        String roomId = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("title-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                "캐주얼 즐겜 방",
                                "Apex Legends",
                                List.of("casual"),
                                5,
                                RoomScope.PUBLIC,
                                RoomType.PERMANENT,
                                "title-host"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("캐주얼 즐겜 방"))
                .andReturn().getResponse().getContentAsString();
        String id = objectMapper.readValue(roomId, RoomResponse.class).id();
        createdRooms.add(id);

        Optional<Room> savedInDb = permanentRoomRepository.findById(id);
        assertTrue(savedInDb.isPresent());
        assertEquals("캐주얼 즐겜 방", savedInDb.get().title(), "MariaDB에 title이 저장되어야 함");

        redis.delete("room:" + id + ":meta");
        redis.opsForSet().remove("game:apex legends:rooms", id);
        redis.opsForSet().remove("tag:casual:rooms", id);

        roomRehydrator.rehydrate();

        mockMvc.perform(get("/api/rooms/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("캐주얼 즐겜 방"));
    }
}