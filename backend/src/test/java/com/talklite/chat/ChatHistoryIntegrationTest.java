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
                        .header("Authorization", tokenFor(host))
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

        // MariaDB 영속화 확인
        assertEquals(2L, countDbRows(roomId), "DB에 2건 저장");

        // GET /api/rooms/{id}/messages 조회 — 과거순(오래된 순) 검증
        JsonNode messages = getMessages(roomId);
        assertEquals(2, messages.size(), "2건 반환");
        assertEquals("hello1", messages.get(0).get("content").asText(), "0번: 첫 번째 메시지");
        assertEquals("hello2", messages.get(1).get("content").asText(), "1번: 두 번째 메시지");

        // limit 파라미터 검증 (limit=1 → 가장 최근 메시지 1건)
        String limitedJson = mockMvc.perform(get("/api/rooms/" + roomId + "/messages").param("limit", "1"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode limitedMessages = objectMapper.readTree(limitedJson);
        assertEquals(1, limitedMessages.size(), "limit=1 적용");
        assertEquals("hello2", limitedMessages.get(0).get("content").asText(), "가장 최근 메시지");
    }

    @Test
    @DisplayName("T-CH-02: Redis 캐시 미스 시 MariaDB에서 폴백 복원")
    void redisCacheMissFallsBackToDatabase() throws Exception {
        SessionResponse session = createSession("ch-fallback-host");
        String roomId = createPermanentRoom("Fallback Game", "ch-fallback-host");

        StompTestClient client = new StompTestClient(port, session.token());
        try {
            client.subscribe("/topic/room/" + roomId + "/chat");
            client.send("/app/room/" + roomId + "/chat",
                    "{\"clientRequestId\":\"req-fb-1\",\"content\":\"persistent-msg\"}");
            String received = client.await(3);
            assertTrue(received != null && received.contains("req-fb-1"));
        } finally {
            client.close();
        }

        assertEquals(1L, countDbRows(roomId), "DB 1건 저장");

        // Redis 캐시 강제 삭제 (캐시 미스 유도)
        redis.delete("room:" + roomId + ":messages");
        assertFalse(Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":messages")), "Redis 캐시 삭제됨");

        // GET /api/rooms/{id}/messages 호출 시 MariaDB에서 폴백 조회 확인
        JsonNode messages = getMessages(roomId);
        assertEquals(1, messages.size(), "DB 폴백으로 1건 복원");
        assertEquals("persistent-msg", messages.get(0).get("content").asText());
    }

    @Test
    @DisplayName("T-CH-03: 방 삭제 시 MariaDB 대화 데이터 및 Redis 캐시 일괄 소멸")
    void roomDeletionDeletesAllChatHistory() throws Exception {
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
                        .header("Authorization", tokenFor("ch-destroyer"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"ch-destroyer\"}"))
                .andExpect(status().isNoContent());

        assertEquals(0L, countDbRows(roomId), "방 삭제 후 DB 대화 내역 소멸");
        assertFalse(Boolean.TRUE.equals(redis.hasKey("room:" + roomId + ":messages")), "방 삭제 후 Redis 캐시 소멸");
        assertEquals(0, getMessages(roomId).size(), "삭제 후 조회 결과 없음");
    }
}
