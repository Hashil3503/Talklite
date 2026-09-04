package com.talklite.performance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.room.*;
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
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class PerformanceLatencyIntegrationTest extends IntegrationTestCleanup {

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

    @Test
    @DisplayName("NFR-PERF-01 & NFR-PERF-03: 500개 병렬 동시 Join 요청 시 정원 원자성 보장 및 99% 응답 지연 <= 200ms 검증")
    void concurrent500JoinRequestsLatencyAndCapacityGuard() throws Exception {
        int capacity = 6;
        int totalRequests = 500;

        String json = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("perf-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest("Overwatch", List.of("comp"), capacity, RoomScope.PUBLIC, RoomType.TEMPORARY, "perf-host"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(json, RoomResponse.class).id();
        createdRooms.add(roomId);

        ExecutorService executor = Executors.newFixedThreadPool(50);
        CountDownLatch readyLatch = new CountDownLatch(totalRequests);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(totalRequests);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger fullCount = new AtomicInteger(0);
        List<Long> latencies = new CopyOnWriteArrayList<>();

        for (int i = 1; i <= totalRequests; i++) {
            final String user = "perf-user-" + i;
            executor.submit(() -> {
                readyLatch.countDown();
                try {
                    startLatch.await();
                    long start = System.currentTimeMillis();
                    int statusCode = mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                                    .header("Authorization", tokenFor(user))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                            .andReturn().getResponse().getStatus();
                    long duration = System.currentTimeMillis() - start;
                    latencies.add(duration);

                    if (statusCode == 200) {
                        successCount.incrementAndGet();
                    } else if (statusCode == 409) {
                        fullCount.incrementAndGet();
                    }
                } catch (Exception ignored) {
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        readyLatch.await(10, TimeUnit.SECONDS);
        startLatch.countDown();
        doneLatch.await(30, TimeUnit.SECONDS);
        executor.shutdown();

        assertEquals(capacity - 1, successCount.get(), "호스트 제외 정확히 정원 수(5명)만큼만 성공해야 함");
        assertEquals(totalRequests - (capacity - 1), fullCount.get(), "나머지는 409(room_full)이어야 함");

        Long memberCount = redis.opsForSet().size("room:" + roomId + ":members");
        assertEquals((long) capacity, memberCount, "Redis 멤버 수도 정확히 6명이어야 함");

        double avgLatency = latencies.stream().mapToLong(Long::longValue).average().orElse(0.0);
        latencies.sort(Long::compareTo);
        long p95Latency = latencies.get((int) (latencies.size() * 0.95));

        assertTrue(avgLatency < 200.0, "평균 지연 시간은 200ms 이내여야 함 (실제: " + avgLatency + "ms)");
        assertTrue(p95Latency < 500.0, "95% 지연 시간은 안정 범위 내여야 함 (실제: " + p95Latency + "ms)");
    }
}