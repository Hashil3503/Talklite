package com.talklite.room;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
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
    private final DefaultRedisScript<Long> gcScript;
    private final DefaultRedisScript<Long> destroyScript;

    public RoomMapper(StringRedisTemplate redis,
                      @Qualifier("gcScript") DefaultRedisScript<Long> gcScript,
                      @Qualifier("destroyScript") DefaultRedisScript<Long> destroyScript) {
        this.redis = redis;
        this.gcScript = gcScript;
        this.destroyScript = destroyScript;
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

    public boolean isVoiceMember(String roomId, String user) {
        Boolean member = redis.opsForSet().isMember(voiceKey(roomId), user);
        return Boolean.TRUE.equals(member);
    }

    public List<String> voiceMembers(String roomId) {
        Set<String> members = redis.opsForSet().members(voiceKey(roomId));
        return members == null ? List.of() : members.stream().sorted().toList();
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
        if (room.scope() == RoomScope.PUBLIC) {
            room.tags().forEach(tag -> redis.opsForSet().add(tagIndexKey(tag), room.id()));
            redis.opsForSet().add(gameIndexKey(room.game()), room.id());
        }
    }

    /** Re-hydration(기동 시) 0명 복원 — 메타 작성 + PUBLIC만 역색인 등록, members/joined_at 미기록 (T-06) */
    public void restore(Room room) {
        Map<String, String> hash = new LinkedHashMap<>();
        hash.put("game", room.game());
        hash.put("tags", String.join(",", room.tags()));
        hash.put("capacity", String.valueOf(room.capacity()));
        hash.put("scope", room.scope().name());
        hash.put("type", room.type().name());
        hash.put("host", room.host());
        hash.put("createdAt", String.valueOf(room.createdAt()));
        redis.opsForHash().putAll(metaKey(room.id()), hash);
        if (room.scope() == RoomScope.PUBLIC) {
            redis.opsForSet().add(gameIndexKey(room.game()), room.id());
            room.tags().forEach(tag -> redis.opsForSet().add(tagIndexKey(tag), room.id()));
        }
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
        return redis.opsForZSet().range(joinedAtKey(roomId), 0, 0).stream().findFirst().orElse(null);
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

    /** 방장 갱신 (meta Hash) */
    public void updateHost(String roomId, String newHost) {
        redis.opsForHash().put(metaKey(roomId), "host", newHost);
    }

    /**
     * 영구방/역색인/초대코드 원자적 파기 (gc.lua, SCARD==0 가드).
     * 동시 입장이 있으면 0(false) 반환 → GC 취소. 이후 임시 밴 키(room:{id}:banned:*)는 SCAN으로 정리.
     */
    public boolean deleteRoom(String roomId, Room room) {
        List<String> args = new ArrayList<>();
        args.add(roomId);
        args.add(room.game());
        room.tags().forEach(args::add);
        Long result = redis.execute(gcScript,
                List.of(
                        metaKey(roomId),
                        membersKey(roomId),
                        joinedAtKey(roomId),
                        voiceKey(roomId),
                        permanentBanKey(roomId),
                        roomInviteKey(roomId)
                ),
                args.toArray());
        if (result != null && result == 1L) {
            deleteByScan("room:" + roomId + ":banned:" + "*");
            return true;
        }
        return false;
    }

    /**
     * 방장 전용 명시적 방 폭파 (destroy.lua).
     * 멤버 수와 무관하게 모든 관련 키/역색인/초대코드를 원자적으로 강제 삭제하고 임시 밴 키를 정리한다.
     */
    public void destroyRoom(String roomId, Room room) {
        List<String> args = new ArrayList<>();
        args.add(roomId);
        args.add(room.game());
        room.tags().forEach(args::add);
        redis.execute(destroyScript,
                List.of(
                        metaKey(roomId),
                        membersKey(roomId),
                        joinedAtKey(roomId),
                        voiceKey(roomId),
                        permanentBanKey(roomId),
                        roomInviteKey(roomId)
                ),
                args.toArray());
        deleteByScan("room:" + roomId + ":banned:*");
    }

    /** Non-blocking SCAN 기반 패턴 키 삭제 (임시 밴 키 정리) */
    private void deleteByScan(String pattern) {
        redis.execute((RedisCallback<Void>) conn -> {
            ScanOptions options = ScanOptions.scanOptions().match(pattern).count(100).build();
            try (Cursor<byte[]> cursor = conn.scan(options)) {
                while (cursor.hasNext()) {
                    conn.del(cursor.next());
                }
            }
            return null;
        });
    }
}
