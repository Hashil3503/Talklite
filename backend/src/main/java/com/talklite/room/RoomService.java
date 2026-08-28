package com.talklite.room;

import com.talklite.chat.PermanentRoomChatRepository;
import com.talklite.realtime.RoomEventPublisher;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

import static com.talklite.realtime.RoomEventPublisher.LOBBY_ROOM_UPDATE;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_HOST_MIGRATED;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_JOIN;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_LEAVE;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_UPDATED;

@Service
public class RoomService {

    private final StringRedisTemplate redis;
    private final RoomMapper roomMapper;
    private final DefaultRedisScript<Long> joinScript;
    private final DefaultRedisScript<Long> updateScript;
    private final RoomEventPublisher eventPublisher;
    private final PermanentRoomRepository permanentRoomRepository;
    private final PermanentRoomChatRepository permanentRoomChatRepository;

    public RoomService(StringRedisTemplate redis,
                   RoomMapper roomMapper,
                   @Qualifier("joinScript") DefaultRedisScript<Long> joinScript,
                   @Qualifier("updateScript") DefaultRedisScript<Long> updateScript,
                   RoomEventPublisher eventPublisher,
                   PermanentRoomRepository permanentRoomRepository,
                   PermanentRoomChatRepository permanentRoomChatRepository) {
        this.redis = redis;
        this.roomMapper = roomMapper;
        this.joinScript = joinScript;
        this.updateScript = updateScript;
        this.eventPublisher = eventPublisher;
        this.permanentRoomRepository = permanentRoomRepository;
        this.permanentRoomChatRepository = permanentRoomChatRepository;
    }



    public RoomResponse create(CreateRoomRequest request, String principal) {
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

    public RoomResponse create(CreateRoomRequest request) {
        return create(request, request.host());
    }

    public RoomResponse get(String roomId) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        String title = (String) redis.opsForHash().get(roomMapper.metaKey(roomId), "title");
        return RoomResponse.from(room, roomMapper.members(roomId), title);
    }

    public RoomResponse join(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        if (room.scope() == RoomScope.PRIVATE) {
            throw new InviteRequiredException();
        }
        return joinInternal(room, user);
    }

    public RoomResponse joinWithInvite(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        return joinInternal(room, user);
    }

    private RoomResponse joinInternal(Room room, String user) {
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
                if (room.type() == RoomType.PERMANENT) {
                    roomMapper.markOrphan(roomId);
                }
            }
        }
        eventPublisher.roomEvent(ROOM_EVENT_LEAVE, room, user, null);

        if (room.type() == RoomType.TEMPORARY) {
            boolean removed = roomMapper.deleteRoom(roomId, room);
            if (removed) {
                eventPublisher.publishRoomRemoved(room);
                String title = (String) redis.opsForHash().get(roomMapper.metaKey(roomId), "title");
                return RoomResponse.from(room, List.of(), title);
            }
        }

        Room current = roomMapper.find(roomId);
        if (current != null) {
            eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, current);
        }
        return get(roomId);
    }

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

    /**
     * Phase 11: 방장 전용 방 정보 수정 (PATCH /api/rooms/{id})
     * - host 검증 403, 존재 검증 404, 정원 충돌 409, 태그 정규화, Lua 원자 재색인, DB 동기화, STOMP 전파
     */
    public RoomResponse updateRoom(String roomId, String principal, UpdateRoomRequest request) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        if (!room.host().equals(principal)) {
            throw new UnauthorizedHostException();
        }

        // Resolve new values (null 또는 blank이면 기존 유지)
        String newTitle = null;
        if (request.title() != null) {
            String t = request.title().trim();
            if (!t.isEmpty()) {
                if (t.length() > 50) throw new IllegalArgumentException("title too long");
                newTitle = t;
            } else {
                // 빈 문자열은 기존 유지?—or empty title not allowed
                newTitle = null;
            }
        } else {
            // 기존 title 유지
            Object existing = redis.opsForHash().get(roomMapper.metaKey(roomId), "title");
            newTitle = existing instanceof String s ? s : null;
        }

        String newGame;
        if (request.game() != null && !request.game().trim().isEmpty()) {
            newGame = request.game().trim();
            if (newGame.length() > 128) throw new IllegalArgumentException("game too long");
        } else {
            newGame = room.game();
        }

        List<String> newTags;
        if (request.tags() != null) {
            newTags = normalizeTags(request.tags());
        } else {
            newTags = room.tags();
        }

        int newCapacity;
        if (request.capacity() != null) {
            newCapacity = request.capacity();
            if (newCapacity < 2 || newCapacity > 10) {
                throw new IllegalArgumentException("capacity out of range");
            }
        } else {
            newCapacity = room.capacity();
        }

        long updatedAt = System.currentTimeMillis();
        String tagsCsv = String.join(",", newTags);
        String titleArg = newTitle != null ? newTitle : "";
        String gameArg = newGame;

        if (updateScript == null) {
            throw new IllegalStateException("updateScript not configured");
        }

        Long result = redis.execute(
                updateScript,
                List.of(
                        roomMapper.metaKey(roomId),
                        roomMapper.membersKey(roomId),
                        roomMapper.voiceKey(roomId)
                ),
                roomId,
                titleArg,
                gameArg,
                String.valueOf(newCapacity),
                tagsCsv,
                String.valueOf(updatedAt)
        );
        long code = result == null ? -1L : result;
        if (code == -1L) {
            throw new RoomNotFoundException(roomId);
        }
        if (code == -2L) {
            throw new RoomCapacityConflictException("room_capacity_conflict");
        }
        if (code != 1L) {
            throw new IllegalStateException("update failed code=" + code);
        }

        if (room.type() == RoomType.PERMANENT) {
            permanentRoomRepository.updateRoom(roomId, newTitle, newGame, newTags, newCapacity, updatedAt);
        }

        Room updated = roomMapper.find(roomId);
        if (updated == null) throw new RoomNotFoundException(roomId);
        String finalTitle = newTitle != null ? newTitle : (String) redis.opsForHash().get(roomMapper.metaKey(roomId), "title");

        // STOMP ROOM_UPDATED 전파 (방 + 로비)
        eventPublisher.publishRoomUpdated(updated, principal, finalTitle, newGame, newTags, newCapacity, updatedAt);

        return RoomResponse.from(updated, roomMapper.members(roomId), finalTitle);
    }

    private List<String> normalizeTags(List<String> tags) {
        if (tags == null) return List.of();
        LinkedHashSet<String> set = new LinkedHashSet<>();
        for (String raw : tags) {
            if (raw == null) continue;
            String t = raw.trim().toLowerCase();
            if (t.isEmpty()) continue;
            // remove duplicate after lowercase
            set.add(t);
            if (set.size() > 5) {
                throw new IllegalArgumentException("too many tags");
            }
        }
        return new ArrayList<>(set);
    }
}
