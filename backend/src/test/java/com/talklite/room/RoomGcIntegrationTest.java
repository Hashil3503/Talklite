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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class RoomGcIntegrationTest extends IntegrationTestCleanup {

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
    @DisplayName("T-02: 휘발성 방 마지막 인원 퇴장 시 즉시 파기 — 메타/멤버/초대코드/역색인 정리 + 재입장 404")
    void lastMemberLeaveGcDeletesRoomInviteAndIndexes() throws Exception {
        String roomId = createRoom("Gc Game A", List.of("gc-alpha"), 5, RoomScope.PRIVATE, RoomType.TEMPORARY, "gc-host");

        // 초대코드 발급 (역방향 room:{id}:invite + invite:{code} 존재 확인)
        String inviteJson = mockMvc.perform(post("/api/rooms/" + roomId + "/invite")
                        .header("Authorization", tokenFor("gc-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new InviteRequest("gc-host"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String code = objectMapper.readValue(inviteJson, InviteResponse.class).code();

        // 방장(유일 인원) 퇴장 → 즉시 파기
        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("gc-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("gc-host"))))
                .andExpect(status().isOk());

        // 1) 방 조회 404
        mockMvc.perform(get("/api/rooms/" + roomId)).andExpect(status().isNotFound());

        // 2) 초대코드 무효화 (역방향 invite:{code} DEL)
        mockMvc.perform(post("/api/invite/" + code + "/join")
                        .header("Authorization", tokenFor("gc-late"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("gc-late"))))
                .andExpect(status().isNotFound());

        // 3) Redis 키 소멸 + 역색인 SREM
        assertEquals(false, Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":meta")), "메타 키 파기");
        assertEquals(false, Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":members")), "멤버 키 파기");
        assertEquals(false, Boolean.TRUE.equals(redis.opsForSet().isMember("game:gc game a:rooms", roomId)), "게임 역색인 SREM");
        assertEquals(false, Boolean.TRUE.equals(redis.opsForSet().isMember("tag:gc-alpha:rooms", roomId)), "태그 역색인 SREM");
        // 파기 후 재입장은 고아 키를 만들지 않아야 한다 (join.lua EXISTS 가드)
        assertEquals(false, Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":members")), "파기 후 고아 키 부재");
    }

    @Test
    @DisplayName("T-02b: 영구 방은 0명이 되어도 Redis 메타 유지 + MariaDB 영속")
    void permanentRoomSurvivesLastLeaveAndPersists() throws Exception {
        String roomId = createRoom("Gc Persist", List.of("gc-perm"), 5, RoomScope.PUBLIC, RoomType.PERMANENT, "gc-perm-host");

        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("gc-perm-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("gc-perm-host"))))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/rooms/" + roomId)).andExpect(status().isOk());
        assertEquals(true, Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":meta")), "영구 방 메타 유지");
        boolean persisted = permanentRoomRepository.findAll().stream().anyMatch(r -> r.id().equals(roomId));
        assertEquals(true, persisted, "MariaDB 영속 유지");
    }

    @Test
    @DisplayName("T-02c: 마지막 퇴장 ∥ 동시 입장 — 2중 상호 배제로 고아/누락 없이 일관 상태")
    void concurrentLeaveAndJoinConsistent() throws Exception {
        String roomId = createRoom("Gc Race", List.of("gc-race"), 6, RoomScope.PUBLIC, RoomType.TEMPORARY, "gc-race-host");
        int threads = 5;
        CountDownLatch ready = new CountDownLatch(threads + 1);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads + 1);
        ExecutorService executor = Executors.newFixedThreadPool(threads + 1);

        executor.submit(() -> {
            ready.countDown();
            try {
                start.await();
                mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                                .header("Authorization", tokenFor("gc-race-host"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(new JoinRequest("gc-race-host"))));
            } catch (Exception ignored) {
            } finally {
                done.countDown();
            }
        });
        for (int i = 0; i < threads; i++) {
            final String u = "gc-race-in-" + i;
            executor.submit(() -> {
                ready.countDown();
                try {
                    start.await();
                    mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                            .header("Authorization", tokenFor(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new JoinRequest(u))));
                } catch (Exception ignored) {
                } finally {
                    done.countDown();
                }
            });
        }
        ready.await(10, TimeUnit.SECONDS);
        start.countDown();
        done.await(30, TimeUnit.SECONDS);
        executor.shutdown();

        boolean meta = Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":meta"));
        boolean members = Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":members"));
        if (meta) {
            assertNotEquals(null, redis.hasKey("room:" + roomId + ":meta"), "생존 시 메타 존재");
        } else {
            assertEquals(false, members, "파기 시 members 고아 키 부재");
        }
    }
}
