package com.talklite.room;

import com.talklite.chat.PermanentRoomChatRepository;
import com.talklite.realtime.RoomEventPublisher;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Instant;
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
    private final PermanentRoomChatRepository permanentRoomChatRepository;

    public RoomService(StringRedisTemplate redis,
                   RoomMapper roomMapper,
                   @Qualifier("joinScript") DefaultRedisScript<Long> joinScript,
                   RoomEventPublisher eventPublisher,
                   PermanentRoomRepository permanentRoomRepository,
                   PermanentRoomChatRepository permanentRoomChatRepository) {
        this.redis = redis;
        this.roomMapper = roomMapper;
        this.joinScript = joinScript;
        this.eventPublisher = eventPublisher;
        this.permanentRoomRepository = permanentRoomRepository;
        this.permanentRoomChatRepository = permanentRoomChatRepository;
    }

    public RoomResponse create(CreateRoomRequest request, String principal) {
        // DEF-01: Principal 강제 — request.host() 무시하고 인증된 principal을 방장으로 사용
        String host = principal;
        Room room = new Room(
                UUID.randomUUID().toString().substring(0, 8),
                request.game().trim(),
                request.tags() == null ? List.of() : request.tags().stream().filter(t -> t != null && !t.isBlank()).map(String::trim).toList(),
                request.capacity(),
                request.scope(),
                request.type(),
                host,
                System.currentTimeMillis()
        );
        roomMapper.save(room);
        if (request.type() == RoomType.PERMANENT) {
            permanentRoomRepository.upsert(room);
        }
        eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, room);
        return get(room.id());
    }

    /** 하위호환: principal 없이 호출되는 경우 request.host() 사용 (테스트 직접 호출 대비) */
    public RoomResponse create(CreateRoomRequest request) {
        return create(request, request.host());
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
        // DEF-02: 재입장 시 자동 승계 판정 — PERMANENT 0명/고아 상태 선체크
        boolean shouldPromote = false;
        if (room.type() == RoomType.PERMANENT) {
            List<String> beforeMembers = roomMapper.members(room.id());
            if (beforeMembers.isEmpty() || roomMapper.isOrphan(room.id())) {
                shouldPromote = true;
            }
        }
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
        // DEF-02: 승계 실행 — 입장 성공 후 고아/빈 방이면 입장자를 새 방장으로 승격
        if (shouldPromote) {
            roomMapper.updateHost(room.id(), user);
            permanentRoomRepository.updateHost(room.id(), user, Instant.now().toEpochMilli());
            roomMapper.clearOrphan(room.id());
            Room promoted = roomMapper.find(room.id());
            if (promoted != null) {
                eventPublisher.roomEvent(ROOM_EVENT_HOST_MIGRATED, promoted, user, null);
            }
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
                room = roomMapper.find(roomId);
                eventPublisher.roomEvent(ROOM_EVENT_HOST_MIGRATED, room, oldest, null);
            } else {
                // DEF-02: 0명 PERMANENT 방장 고아화 방지 — 남은 인원 0명이면 고아 상태로 전환
                if (room.type() == RoomType.PERMANENT) {
                    roomMapper.markOrphan(roomId);
                }
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
     * 3. 채팅 대화 내역 영구 소멸 (MariaDB permanent_room_chat 전체 삭제)
     * 4. Redis destroy.lua 원자적 강제 파기 (room:{id}:messages 포함)
     * 5. /topic/room/{id} ROOM_DESTROYED 이벤트 및 /topic/lobby ROOM_REMOVED 이벤트 전파
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
        permanentRoomChatRepository.deleteByRoomId(roomId);
        roomMapper.destroyRoom(roomId, room);
        eventPublisher.publishRoomDestroyed(room, actor);
        eventPublisher.publishRoomRemoved(room);
    }
}
