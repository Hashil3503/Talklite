package com.talklite.room;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class RoomMapper {

    public static final String META_KEY_PREFIX = "room:%s:meta";
    public static final String MEMBERS_KEY_PREFIX = "room:%s:members";
    public static final String TAG_INDEX_PREFIX = "tag:%s:rooms";
    public static final String GAME_INDEX_PREFIX = "game:%s:rooms";

    private final StringRedisTemplate redis;

    public RoomMapper(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public String metaKey(String roomId) {
        return META_KEY_PREFIX.formatted(roomId);
    }

    public String membersKey(String roomId) {
        return MEMBERS_KEY_PREFIX.formatted(roomId);
    }

    public String tagIndexKey(String tag) {
        return TAG_INDEX_PREFIX.formatted(tag);
    }

    public String gameIndexKey(String game) {
        return GAME_INDEX_PREFIX.formatted(game.toLowerCase());
    }

    public void save(Room room) {
        Map<String, String> hash = new LinkedHashMap<>();
        hash.put("game", room.game());
        hash.put("tags", String.join(",", room.tags()));
        hash.put("capacity", String.valueOf(room.capacity()));
        hash.put("scope", room.scope().name());
        hash.put("type", room.type().name());
        hash.put("host", room.host());
        hash.put("createdAt", String.valueOf(room.createdAt()));
        redis.opsForHash().putAll(metaKey(room.id()), hash);
        redis.opsForSet().add(membersKey(room.id()), room.host());
        room.tags().forEach(tag -> redis.opsForSet().add(tagIndexKey(tag), room.id()));
        redis.opsForSet().add(gameIndexKey(room.game()), room.id());
    }

    public Room find(String roomId) {
        Map<Object, Object> hash = redis.opsForHash().entries(metaKey(roomId));
        if (hash.isEmpty()) {
            return null;
        }
        String tagsValue = (String) hash.get("tags");
        List<String> tags = tagsValue == null || tagsValue.isBlank()
                ? List.of()
                : List.of(tagsValue.split(","));
        return new Room(
                roomId,
                (String) hash.get("game"),
                tags,
                Integer.parseInt((String) hash.get("capacity")),
                RoomScope.valueOf((String) hash.get("scope")),
                RoomType.valueOf((String) hash.get("type")),
                (String) hash.get("host"),
                Long.parseLong((String) hash.get("createdAt"))
        );
    }

    public List<String> members(String roomId) {
        return redis.opsForSet().members(membersKey(roomId)).stream().sorted().toList();
    }
}
