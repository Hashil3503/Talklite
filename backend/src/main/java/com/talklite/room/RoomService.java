package com.talklite.room;

import com.talklite.realtime.RoomEventPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

import static com.talklite.realtime.RoomEventPublisher.LOBBY_ROOM_UPDATE;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_HOST_MIGRATED;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_JOIN;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_LEAVE;

@Service
public class RoomService {

    private final StringRedisTemplate redis;
    private final RoomMapper roomMapper;
    private final DefaultRedisScript<Long> joinScript;
    private final RoomEventPublisher eventPublisher;

    public RoomService(StringRedisTemplate redis, RoomMapper roomMapper, DefaultRedisScript<Long> joinScript, RoomEventPublisher eventPublisher) {
        this.redis = redis;
        this.roomMapper = roomMapper;
        this.joinScript = joinScript;
        this.eventPublisher = eventPublisher;
    }

    public RoomResponse create(CreateRoomRequest request) {
        Room room = new Room(
                UUID.randomUUID().toString().substring(0, 8),
                request.game().trim(),
                request.tags() == null ? List.of() : request.tags().stream().filter(t -> t != null && !t.isBlank()).map(String::trim).toList(),
                request.capacity(),
                request.scope(),
                request.type(),
                request.host(),
                System.currentTimeMillis()
        );
        roomMapper.save(room);
        eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, room);
        return get(room.id());
    }

    public RoomResponse get(String roomId) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        return RoomResponse.from(room, roomMapper.members(roomId));
    }

    public RoomResponse join(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        // 비공개 방 직접 join 차단 (FR-ROOM-04, NFR-SEC-02)
        if (room.scope() == RoomScope.PRIVATE) {
            throw new InviteRequiredException();
        }
        return joinInternal(room, user);
    }

    /** 초대코드 경유 입장 (non-public 허용) */
    public RoomResponse joinWithInvite(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        return joinInternal(room, user);
    }

    private RoomResponse joinInternal(Room room, String user) {
        Long code = redis.execute(
                joinScript,
                List.of(
                        roomMapper.membersKey(room.id()),
                        roomMapper.joinedAtKey(room.id()),
                        roomMapper.permanentBanKey(room.id()),
                        roomMapper.temporaryBanKey(room.id(), user)
                ),
                user,
                String.valueOf(room.capacity()),
                String.valueOf(System.currentTimeMillis())
        );
        Long result = code == null ? 1L : code;
        if (result == -2L || result == -3L) {
            throw new UserBannedException();
        }
        if (result == -1L) {
            throw new RoomFullException();
        }
        Room current = roomMapper.find(room.id());
        eventPublisher.roomEvent(ROOM_EVENT_JOIN, current, user, null);
        eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, current);
        return get(room.id());
    }

    public RoomResponse leave(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        redis.opsForSet().remove(roomMapper.membersKey(roomId), user);
        redis.opsForZSet().remove(roomMapper.joinedAtKey(roomId), user);
        roomMapper.removeVoice(roomId, user);
        if (room.host().equals(user)) {
            String oldest = roomMapper.oldestMember(roomId);
            if (oldest != null) {
                roomMapper.updateHost(roomId, oldest);
                eventPublisher.roomEvent(ROOM_EVENT_HOST_MIGRATED, room, oldest, null);
            }
        }
        eventPublisher.roomEvent(ROOM_EVENT_LEAVE, room, user, null);
        Room current = roomMapper.find(roomId);
        if (current != null) {
            eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, current);
        }
        return get(roomId);
    }
}
