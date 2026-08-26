package com.talklite.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.realtime.RoomEventPublisher;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomType;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@Service
public class ChatService {

    public static final String TYPE_TALK = "TALK";

    /** Redis List 최대 보관 건수 (LPUSH + LTRIM 0 99) */
    public static final long MAX_CACHED_MESSAGES = 100;
    public static final int DEFAULT_MESSAGE_LIMIT = 50;
    public static final int MAX_MESSAGE_LIMIT = 100;

    private final RoomEventPublisher eventPublisher;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final RoomMapper roomMapper;
    private final PermanentRoomChatRepository permanentRoomChatRepository;

    public ChatService(RoomEventPublisher eventPublisher,
                       StringRedisTemplate redis,
                       ObjectMapper objectMapper,
                       RoomMapper roomMapper,
                       PermanentRoomChatRepository permanentRoomChatRepository) {
        this.eventPublisher = eventPublisher;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.roomMapper = roomMapper;
        this.permanentRoomChatRepository = permanentRoomChatRepository;
    }

    /**
     * 발신자는 클라이언트 페이로드가 아닌 Principal(인증 세션) 기반.
     * 전송된 메시지는 Redis List(room:{id}:messages, 최근 100건)에 캐시되고,
     * 영구 방(PERMANENT)은 MariaDB(permanent_room_chat)에도 영속화된다.
     */
    public void send(String roomId, String sender, SendChatRequest request) {
        String content = request.content() == null ? "" : request.content().trim();
        if (content.isEmpty() || content.length() > 500) {
            return;
        }
        ChatMessage message = new ChatMessage(
                "msg-" + UUID.randomUUID(),
                request.clientRequestId(),
                roomId,
                sender,
                sender,
                content,
                System.currentTimeMillis(),
                TYPE_TALK
        );
        persist(roomId, message);
        eventPublisher.chat(roomId, message);
    }

    /**
     * 최근 대화 내역 조회 (입장/새로고침 시 복원용).
     * Redis 캐시 우선 → 미존재 시 MariaDB 폴백. 반환은 과거순(오래된 순).
     */
    public List<ChatMessage> recentMessages(String roomId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_MESSAGE_LIMIT));
        List<ChatMessage> cached = readFromRedisCache(roomId, safeLimit);
        if (!cached.isEmpty()) {
            return cached;
        }
        return permanentRoomChatRepository.findRecentMessages(roomId, safeLimit);
    }

    private void persist(String roomId, ChatMessage message) {
        try {
            String json = objectMapper.writeValueAsString(message);
            String key = roomMapper.chatMessagesKey(roomId);
            redis.opsForList().leftPushAll(key, List.of(json));
            redis.opsForList().trim(key, 0, MAX_CACHED_MESSAGES - 1);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("failed to serialize chat message", e);
        }
        var room = roomMapper.find(roomId);
        if (room != null && room.type() == RoomType.PERMANENT) {
            permanentRoomChatRepository.save(message);
        }
    }

    private List<ChatMessage> readFromRedisCache(String roomId, int limit) {
        List<String> raw = redis.opsForList().range(roomMapper.chatMessagesKey(roomId), 0, limit - 1L);
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        List<ChatMessage> messages = new ArrayList<>();
        for (String json : raw) {
            try {
                messages.add(objectMapper.readValue(json, ChatMessage.class));
            } catch (JsonProcessingException ignored) {
                // 손상된 캐시 엔트리는 무시
            }
        }
        if (messages.isEmpty()) {
            return List.of();
        }
        Collections.reverse(messages); // LPUSH 최신우선 → 과거순 정렬
        return messages;
    }
}
