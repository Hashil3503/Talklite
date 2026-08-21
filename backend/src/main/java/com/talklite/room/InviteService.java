package com.talklite.room;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;

@Service
public class InviteService {

    private static final String CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;
    private final RoomMapper roomMapper;
    private final RoomService roomService;

    public InviteService(StringRedisTemplate redis, RoomMapper roomMapper, RoomService roomService) {
        this.redis = redis;
        this.roomMapper = roomMapper;
        this.roomService = roomService;
    }

    public InviteResponse create(String roomId, String actor) {
        Room room = requireMember(roomId, actor);
        String code = null;
        for (int attempt = 0; attempt < 3 && code == null; attempt++) {
            String candidate = generate();
            Boolean acquired = redis.opsForValue().setIfAbsent(
                    roomMapper.inviteKey(candidate), roomId, Duration.ofSeconds(RoomMapper.INVITE_TTL_SECONDS));
            if (Boolean.TRUE.equals(acquired)) {
                redis.opsForValue().set(roomMapper.roomInviteKey(roomId), candidate, Duration.ofSeconds(RoomMapper.INVITE_TTL_SECONDS));
                code = candidate;
            }
        }
        if (code == null) {
            throw new IllegalStateException("invite code generation failed");
        }
        return new InviteResponse(code, roomId, RoomMapper.INVITE_TTL_SECONDS);
    }

    public String getOrCreate(String roomId, String actor) {
        Room room = requireMember(roomId, actor);
        String code = redis.opsForValue().get(roomMapper.roomInviteKey(roomId));
        if (code == null) {
            return create(room.id(), actor).code();
        }
        return code;
    }

    public RoomResponse joinByCode(String code, String user) {
        String roomId = redis.opsForValue().get(roomMapper.inviteKey(code));
        if (roomId == null) {
            throw new InvalidInviteCodeException();
        }
        return roomService.joinWithInvite(roomId, user);
    }

    private Room requireMember(String roomId, String actor) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        if (actor == null || actor.isBlank() || !roomMapper.members(roomId).contains(actor)) {
            throw new UnauthorizedHostException();
        }
        return room;
    }

    private String generate() {
        StringBuilder sb = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            sb.append(CODE_CHARSET.charAt(RANDOM.nextInt(CODE_CHARSET.length())));
        }
        return sb.toString();
    }
}
