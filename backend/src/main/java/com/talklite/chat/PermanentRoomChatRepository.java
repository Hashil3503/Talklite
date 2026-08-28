package com.talklite.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Collections;
import java.util.List;

/**
 * 영구 방(PERMANENT) 채팅 대화 내역 MariaDB 영속화 리포지토리.
 * Redis List(room:{id}:messages, 최근 100건 캐시) 미존재 시 폴백 조회원,
 * 방 삭제 시 deleteByRoomId로 완전 소멸한다.
 */
@Repository
public class PermanentRoomChatRepository {

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public PermanentRoomChatRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    /** ChatMessage 1건 영속화 (id = messageId, created_at = timestamp) */
    public void save(ChatMessage message) {
        String mentionsJson = null;
        if (message.mentions() != null && !message.mentions().isEmpty()) {
            try {
                mentionsJson = objectMapper.writeValueAsString(message.mentions());
            } catch (JsonProcessingException e) {
                mentionsJson = null;
            }
        }
        jdbc.sql("""
                INSERT INTO permanent_room_chat (id, room_id, sender, sender_nickname, content, created_at, type, media_url, mentions)
                VALUES (:id, :roomId, :sender, :senderNickname, :content, :createdAt, :type, :mediaUrl, :mentions)
                """)
                .param("id", message.messageId())
                .param("roomId", message.roomId())
                .param("sender", message.sender())
                .param("senderNickname", message.senderName())
                .param("content", message.content())
                .param("createdAt", message.timestamp())
                .param("type", message.type())
                .param("mediaUrl", message.mediaUrl())
                .param("mentions", mentionsJson)
                .update();
    }

    /**
     * 최근 대화 내역 limit건을 과거순(오래된 순)으로 반환.
     * DB에서 최신순 DESC LIMIT 조회 후 뒤집어 과거순을 보장한다.
     */
    public List<ChatMessage> findRecentMessages(String roomId, int limit) {
        List<ChatMessage> recent = jdbc.sql("""
                        SELECT id, room_id, sender, sender_nickname, content, created_at, type, media_url, mentions
                        FROM permanent_room_chat
                        WHERE room_id = :roomId
                        ORDER BY created_at DESC
                        LIMIT :limit
                        """)
                .param("roomId", roomId)
                .param("limit", limit)
                .query((rs, rowNum) -> {
                    String mentionsRaw = rs.getString("mentions");
                    List<String> mentions = List.of();
                    if (mentionsRaw != null && !mentionsRaw.isBlank()) {
                        try {
                            // JSON 배열 파싱 (["uid1","uid2"])
                            mentions = objectMapper.readValue(mentionsRaw, new TypeReference<>() {});
                        } catch (Exception ex) {
                            // 레거시 콤마 분리 폴백
                            mentions = List.of(mentionsRaw.split(","));
                        }
                    }
                    return new ChatMessage(
                            rs.getString("id"),
                            null,
                            rs.getString("room_id"),
                            rs.getString("sender"),
                            rs.getString("sender_nickname"),
                            rs.getString("content"),
                            rs.getLong("created_at"),
                            rs.getString("type"),
                            rs.getString("media_url"),
                            mentions
                    );
                })
                .list();
        Collections.reverse(recent);
        return recent;
    }

    /** 방 파기 시 해당 방 대화 내역 전체 삭제 */
    public void deleteByRoomId(String roomId) {
        jdbc.sql("DELETE FROM permanent_room_chat WHERE room_id = :roomId")
                .param("roomId", roomId)
                .update();
    }
}
