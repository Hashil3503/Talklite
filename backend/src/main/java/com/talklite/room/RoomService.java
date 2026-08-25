package com.talklite.room;

import com.talklite.realtime.RoomEventPublisher;
import org.springframework.beans.factory.annotation.Qualifier;
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
    private final PermanentRoomRepository permanentRoomRepository;

    public RoomService(StringRedisTemplate redis,
                   RoomMapper roomMapper,
                   @Qualifier("joinScript") DefaultRedisScript<Long> joinScript,
                   RoomEventPublisher eventPublisher,
                   PermanentRoomRepository permanentRoomRepository) {
        this.redis = redis;
        this.roomMapper = roomMapper;
        this.joinScript = joinScript;
        this.eventPublisher = eventPublisher;
        this.permanentRoomRepository = permanentRoomRepository;
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
        if (request.type() == RoomType.PERMANENT) {
            permanentRoomRepository.upsert(room);
        }
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
                        roomMapper.temporaryBanKey(room.id(), user),
                        roomMapper.metaKey(room.id())
                ),
                user,
                String.valueOf(room.capacity()),
                String.valueOf(System.currentTimeMillis())
        );
        Long result = code == null ? 1L : code;
        if (result == -4L) {
            throw new RoomNotFoundException(room.id());
        }
        if (result == -2L || result == -3L) {
            throw new UserBannedException();
        }
        if (result == -1L) {
            throw new RoomFullException();
        }
        Room current = roomMapper.find(room.id());
        if (current == null) {
            throw new RoomNotFoundException(room.id());
        }
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
                if (room.type() == RoomType.PERMANENT) {
                    permanentRoomRepository.updateHost(roomId, oldest, System.currentTimeMillis());
                }
                eventPublisher.roomEvent(ROOM_EVENT_HOST_MIGRATED, room, oldest, null);
            }
        }
        eventPublisher.roomEvent(ROOM_EVENT_LEAVE, room, user, null);

        // 휘발성 방: 마지막 인원 퇴장 → 원자적 파기 (gc.lua SCARD==0 가드, T-02)
        if (room.type() == RoomType.TEMPORARY) {
            boolean removed = roomMapper.deleteRoom(roomId, room);
            if (removed) {
                eventPublisher.publishRoomRemoved(room);
                return RoomResponse.from(room, List.of());
            }
        }

        Room current = roomMapper.find(roomId);
        if (current != null) {
            eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, current);
        }
        return get(roomId);
    }

    /**
     * 방장 전용 명시적 방 삭제 (Phase 7, FR-ROOM-08, T-10).
     * 1. 방장 권한(actor == host) 검증
     * 2. MariaDB permanent_room 선삭제 (서버 재기동 부활 방지)
     * 3. Redis destroy.lua 원자적 강제 파기
     * 4. /topic/room/{id} ROOM_DESTROYED 이벤트 및 /topic/lobby ROOM_REMOVED 이벤트 전파
     */
    public void deleteByHost(String roomId, String actor) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        if (!room.host().equals(actor)) {
            throw new UnauthorizedHostException();
        }
        if (room.type() == RoomType.PERMANENT) {
            permanentRoomRepository.delete(roomId);
        }
        roomMapper.destroyRoom(roomId, room);
        eventPublisher.publishRoomDestroyed(room, actor);
        eventPublisher.publishRoomRemoved(room);
    }
}
