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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class RoomConcurrencyIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("T-01: 정원 3명 방(방장 1석)에 10개 스레드 동시 입장 시 정확히 2명만 성공, 8명 409")
    void concurrentJoinRespectsCapacityExactly() throws Exception {
        CreateRoomRequest createRequest = new CreateRoomRequest(
                "Concurrency Game",
                List.of("race"),
                3,
                RoomScope.PUBLIC,
                RoomType.TEMPORARY,
                "host-conc"
        );
        String responseContent = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequest)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(responseContent, RoomResponse.class).id();

        int threads = 10;
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger conflict = new AtomicInteger();
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        ExecutorService executor = Executors.newFixedThreadPool(threads);

        for (int i = 0; i < threads; i++) {
            final String user = "conc-" + i;
            executor.submit(() -> {
                try {
                    ready.countDown();
                    start.await();
                    int status = mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(objectMapper.writeValueAsString(new JoinRequest(user))))
                            .andReturn().getResponse().getStatus();
                    if (status == 200) {
                        ok.incrementAndGet();
                    } else if (status == 409) {
                        conflict.incrementAndGet();
                    }
                } catch (Exception e) {
                    // ignore
                } finally {
                    done.countDown();
                }
            });
        }

        ready.await(10, TimeUnit.SECONDS);
        start.countDown();
        boolean finished = done.await(30, TimeUnit.SECONDS);
        executor.shutdown();

        assertEquals(true, finished, "concurrent joins must finish within timeout");
        // 방장(host)이 1석 차지 → 정원 3 중 동시 입장은 정확히 2명만 성공 (전체 멤버 == capacity)
        assertEquals(2, ok.get(), "동시 입장은 정확히 (정원 - 방장 1석)만 성공해야 한다");
        assertEquals(8, conflict.get(), "나머지는 409로 거절되어야 한다");
    }
}
