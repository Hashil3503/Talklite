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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ChatService {

    public static final String TYPE_TALK = "TALK";
    public static final String TYPE_IMAGE = "IMAGE";

    /** Redis List 최대 보관 건수 (LPUSH + LTRIM 0 99) */
    public static final long MAX_CACHED_MESSAGES = 100;
    public static final int DEFAULT_MESSAGE_LIMIT = 50;
    public static final int MAX_MESSAGE_LIMIT = 100;

    /** @멘션 토큰: (^|\\s)@([A-Za-z0-9._\\-가-힣]{1,64}|everyone|all)\\b — 36자 UUID 멘션 포함 (hyphen 포함) */
    static final Pattern MENTION_PATTERN = Pattern.compile(
            "(^|\\s)@([A-Za-z0-9._\\-가-힣]{1,64}|everyone|all)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

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
     * type/mediaUrl/mentions 확장 — mentions는 서버 확정.
     */
    public void send(String roomId, String sender, SendChatRequest request) {
        String rawContent = request.content() == null ? "" : request.content().trim();
        String rawType = request.type() == null || request.type().isBlank() ? TYPE_TALK : request.type().trim().toUpperCase();
        boolean isImage = TYPE_IMAGE.equals(rawType);
        boolean isTalk = TYPE_TALK.equals(rawType);
        if (!isTalk && !isImage) {
            return;
        }

        String mediaUrl = request.mediaUrl() == null ? null : request.mediaUrl().trim();
        if (isTalk) {
            if (rawContent.isEmpty() || rawContent.length() > 500) {
                return;
            }
            mediaUrl = null;
        } else {
            // IMAGE: mediaUrl 필수, content는 캡션(선택, 500자 이내)
            if (mediaUrl == null || mediaUrl.isEmpty() || !mediaUrl.startsWith("/api/images/")) {
                return;
            }
            if (rawContent.length() > 500) {
                return;
            }
        }

        List<String> mentions = resolveMentions(roomId, rawContent);

        ChatMessage message = new ChatMessage(
                "msg-" + UUID.randomUUID(),
                request.clientRequestId(),
                roomId,
                sender,
                sender,
                rawContent,
                System.currentTimeMillis(),
                rawType,
                mediaUrl,
                mentions
        );
        persist(roomId, message);
        eventPublisher.chat(roomId, message);
    }

    List<String> resolveMentions(String roomId, String content) {
        if (content == null || content.isEmpty()) return List.of();
        Matcher m = MENTION_PATTERN.matcher(content);
        LinkedHashSet<String> tokens = new LinkedHashSet<>();
        while (m.find()) {
            tokens.add(m.group(2).toLowerCase(java.util.Locale.ROOT));
        }
        if (tokens.isEmpty()) return List.of();

        List<String> members = roomMapper.members(roomId);
        if (members.isEmpty()) {
            // Redis 미조회시 캐시 빈 상태 방어: 빈 mentions 반환
            return List.of();
        }
        LinkedHashSet<String> resolved = new LinkedHashSet<>();
        for (String token : tokens) {
            if ("everyone".equals(token) || "all".equals(token)) {
                resolved.addAll(members);
            } else {
                members.stream()
                        .filter(member -> member.equalsIgnoreCase(token))
                        .findFirst()
                        .ifPresent(resolved::add);
            }
        }
        return List.copyOf(resolved);
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
