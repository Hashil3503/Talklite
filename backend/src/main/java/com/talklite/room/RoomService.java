package com.talklite.room;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class RoomService {

    private final StringRedisTemplate redis;
    private final RoomMapper roomMapper;

    public RoomService(StringRedisTemplate redis, RoomMapper roomMapper) {
        this.redis = redis;
        this.roomMapper = roomMapper;
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
        Long count = redis.opsForSet().size(roomMapper.membersKey(roomId));
        if (count != null && count >= room.capacity()) {
            throw new RoomFullException();
        }
        redis.opsForSet().add(roomMapper.membersKey(roomId), user);
        return get(roomId);
    }

    public RoomResponse leave(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        redis.opsForSet().remove(roomMapper.membersKey(roomId), user);
        return get(roomId);
    }
}
