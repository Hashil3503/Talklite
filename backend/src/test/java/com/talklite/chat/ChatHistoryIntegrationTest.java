package com.talklite.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.StompTestClient;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class ChatHistoryIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JdbcClient jdbc;

    @LocalServerPort
    private int port;

    private SessionResponse createSession(String user) throws Exception {
        String json = mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new SessionRequest(user))))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, SessionResponse.class);
    }

    private String createPermanentRoom(String game, String host) throws Exception {
        String json = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                game, List.of("chat-history"), 5,
                                RoomScope.PUBLIC, RoomType.PERMANENT, host))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, RoomResponse.class).id();
    }

    private JsonNode getMessages(String roomId) throws Exception {
        String json = mockMvc.perform(get("/api/rooms/" + roomId + "/messages"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(json);
    }

    private long countDbRows(String roomId) {
        return jdbc.sql("SELECT COUNT(*) FROM permanent_room_chat WHERE room_id = :roomId")
                .param("roomId", roomId)
                .query(Long.class)
                .single();
    }

    @Test
    @DisplayName("T-CH-01: 영구 방 채팅 전송 → Redis 캐시/MariaDB 저장 → GET /messages 과거순 복원 + limit 파라미터")
    void permanentRoomChatIsPersistedAndRestored() throws Exception {
        SessionResponse session = createSession("ch-host");
        String roomId = createPermanentRoom("History Game", "ch-host");

        StompTestClient client = new StompTestClient(port, session.token());
        try {
            client.subscribe("/topic/room/" + roomId + "/chat");

            client.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-1\",\"content\":\"hello1\"}");
            String r1 = client.await(3);
            assertTrue(r1 != null && r1.contains("req-1"), "첫 메시지 에코 수신");

            client.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-2\",\"content\":\"hello2\"}");
            String r2 = client.await(3);
            assertTrue(r2 != null && r2.contains("req-2"), "두 번째 메시지 에코 수신");
        } finally {
            client.close();
        }

        Long cachedSize = redis.opsForList().size("room:" + roomId + ":messages");
        assertEquals(2L, cachedSize == null ? 0 : cachedSize, "Redis List에 2건 캐시");
        assertEquals(2L, countDbRows(roomId), "MariaDB permanent_room_chat 2건");

        JsonNode messages = getMessages(roomId);
        assertEquals(2, messages.size(), "대화 내역 2건 복원");
        assertEquals("hello1", messages.get(0).get("content").asText(), "첫 번째는 오래된 메시지(과거순)");
        assertEquals("hello2", messages.get(1).get("content").asText(), "두 번째는 최신 메시지(과거순)");
        assertEquals("ch-host", messages.get(0).get("sender").asText(), "sender는 Principal 기반");
        assertEquals("TALK", messages.get(0).get("type").asText());
        assertTrue(messages.get(0).get("timestamp").asLong() <= messages.get(1).get("timestamp").asLong(),
                "timestamp 오름차순 정렬");

        String limitedJson = mockMvc.perform(get("/api/rooms/" + roomId + "/messages").param("limit", "1"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode limited = objectMapper.readTree(limitedJson);
        assertEquals(1, limited.size());
        assertEquals("hello2", limited.get(0).get("content").asText(), "limit 조회는 최신 1건");
    }

    @Test
    @DisplayName("T-CH-02: Redis 캐시 미존재 시 MariaDB 폴백 조회 (서버 재시작/캐시 만료 시나리오)")
    void fallsBackToMariaDbWhenCacheMissing() throws Exception {
        SessionResponse session = createSession("ch-fallback");
        String roomId = createPermanentRoom("Fallback Game", "ch-fallback");

        StompTestClient client = new StompTestClient(port, session.token());
        try {
            client.subscribe("/topic/room/" + roomId + "/chat");
            client.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-fb-1\",\"content\":\"fallback-msg\"}");
            String received = client.await(3);
            assertTrue(received != null && received.contains("req-fb-1"));
        } finally {
            client.close();
        }

        Boolean deleted = redis.delete("room:" + roomId + ":messages");
        assertTrue(Boolean.TRUE.equals(deleted), "캐시 키 삭제 확인");

        JsonNode messages = getMessages(roomId);
        assertEquals(1, messages.size(), "MariaDB 폴백으로 대화 내역 복원");
        assertEquals("fallback-msg", messages.get(0).get("content").asText());
    }

    @Test
    @DisplayName("T-CH-03: 방 삭제 시 MariaDB/Redis 대화 내역 완전 소멸 (destroy.lua room:{id}:messages 포함)")
    void roomDeletionPurgesChatEverywhere() throws Exception {
        SessionResponse session = createSession("ch-destroyer");
        String roomId = createPermanentRoom("Destroy Game", "ch-destroyer");

        StompTestClient client = new StompTestClient(port, session.token());
        try {
            client.subscribe("/topic/room/" + roomId + "/chat");
            client.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-del-1\",\"content\":\"to-be-deleted\"}");
            String received = client.await(3);
            assertTrue(received != null && received.contains("req-del-1"));
        } finally {
            client.close();
        }

        assertEquals(1L, countDbRows(roomId), "삭제 전 DB 1건");
        assertTrue(Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":messages")), "삭제 전 Redis 캐시 존재");

        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"ch-destroyer\"}"))
                .andExpect(status().isNoContent());

        assertEquals(0L, countDbRows(roomId), "방 삭제 후 DB 대화 내역 소멸");
        assertFalse(Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":messages")), "방 삭제 후 Redis 캐시 소멸");
        assertEquals(0, getMessages(roomId).size(), "삭제 후 조회 결과 없음");
    }
}
