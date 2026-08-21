package com.talklite.room;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Component
public class RoomMapper {

    public static final String META_KEY_PREFIX = "room:%s:meta";
    public static final String MEMBERS_KEY_PREFIX = "room:%s:members";
    public static final String JOINED_AT_KEY_PREFIX = "room:%s:joined_at";
    public static final String PERMANENT_BAN_KEY_PREFIX = "room:%s:banned";
    public static final String TEMPORARY_BAN_KEY_PREFIX = "room:%s:banned:%s";
    public static final String VOICE_KEY_PREFIX = "room:%s:voice";
    public static final String TAG_INDEX_PREFIX = "tag:%s:rooms";
    public static final String GAME_INDEX_PREFIX = "game:%s:rooms";
    public static final String INVITE_KEY_PREFIX = "invite:%s";
    public static final String ROOM_INVITE_KEY_PREFIX = "room:%s:invite";
    public static final long TEMPORARY_BAN_TTL_SECONDS = 600;
    public static final long INVITE_TTL_SECONDS = 86400;

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

    public String joinedAtKey(String roomId) {
        return JOINED_AT_KEY_PREFIX.formatted(roomId);
    }

    public String permanentBanKey(String roomId) {
        return PERMANENT_BAN_KEY_PREFIX.formatted(roomId);
    }

    public String temporaryBanKey(String roomId, String user) {
        return TEMPORARY_BAN_KEY_PREFIX.formatted(roomId, user);
    }

    public String voiceKey(String roomId) {
        return VOICE_KEY_PREFIX.formatted(roomId);
    }

    public String inviteKey(String code) {
        return INVITE_KEY_PREFIX.formatted(code);
    }

    public String roomInviteKey(String roomId) {
        return ROOM_INVITE_KEY_PREFIX.formatted(roomId);
    }

    public void addVoice(String roomId, String user) {
        redis.opsForSet().add(voiceKey(roomId), user);
    }

    public void removeVoice(String roomId, String user) {
        redis.opsForSet().remove(voiceKey(roomId), user);
    }

    public int voiceCount(String roomId) {
        Long size = redis.opsForSet().size(voiceKey(roomId));
        return size == null ? 0 : size.intValue();
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
        recordJoinTime(room.id(), room.host(), room.createdAt());
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

    /** 입장 시각(ZSet) 기록 — score = epoch millis */
    public void recordJoinTime(String roomId, String user, long timestamp) {
        redis.opsForZSet().add(joinedAtKey(roomId), user, timestamp);
    }

    /** 체류 시간이 가장 긴 멤버 조회 (member, 없으면 null) */
    public String oldestMember(String roomId) {
        Set<ZSetOperations.TypedTuple<String>> tuples =
                redis.opsForZSet().rangeWithScores(joinedAtKey(roomId), 0, 0);
        if (tuples == null || tuples.isEmpty()) {
            return null;
        }
        return tuples.iterator().next().getValue();
    }

    /** 방장 위임: meta.host 갱신 */
    public void updateHost(String roomId, String newHost) {
        redis.opsForHash().put(metaKey(roomId), "host", newHost);
    }

    /** 멤버 제거 (members Set + joined_at ZSet 원자 제거) */
    public void removeMember(String roomId, String user) {
        redis.opsForSet().remove(membersKey(roomId), user);
        redis.opsForZSet().remove(joinedAtKey(roomId), user);
    }

    /** 임시 강퇴: 밴 키 SETEX (TTL 600s) */
    public void temporaryBan(String roomId, String user) {
        redis.opsForValue().set(temporaryBanKey(roomId, user), "temp", TEMPORARY_BAN_TTL_SECONDS, TimeUnit.SECONDS);
    }

    /** 영구 강퇴: 밴 Set SADD */
    public void permanentBan(String roomId, String user) {
        redis.opsForSet().add(permanentBanKey(roomId), user);
    }
}
