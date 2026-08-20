package com.talklite.search;

import com.talklite.room.RoomMapper;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

@Service
public class SearchService {

    public static final int LIMIT = 50;

    private static final String ROOM_PREFIX = "room:";
    private static final String META_SUFFIX = ":meta";

    private final StringRedisTemplate redis;
    private final RoomMapper roomMapper;

    public SearchService(StringRedisTemplate redis, RoomMapper roomMapper) {
        this.redis = redis;
        this.roomMapper = roomMapper;
    }

    public List<RoomResponse> search(String game, String tags) {
        List<String> tagList = parseTags(tags);
        Set<String> roomIds = candidateRoomIds(game, tagList);

        return roomIds.stream()
                .map(roomMapper::find)
                .filter(Objects::nonNull)
                .filter(room -> room.scope() == RoomScope.PUBLIC)
                .map(room -> RoomResponse.from(room, roomMapper.members(room.id())))
                .sorted(Comparator.comparingLong(RoomResponse::createdAt).reversed())
                .limit(LIMIT)
                .toList();
    }

    private Set<String> candidateRoomIds(String game, List<String> tagList) {
        List<String> keys = new ArrayList<>();
        tagList.forEach(tag -> keys.add(roomMapper.tagIndexKey(tag)));
        if (!isBlank(game)) {
            keys.add(roomMapper.gameIndexKey(game.trim()));
        }
        if (keys.isEmpty()) {
            return allRoomIds();
        }
        return redis.opsForSet().intersect(keys);
    }

    private Set<String> allRoomIds() {
        Set<String> ids = new LinkedHashSet<>();
        redis.keys(RoomMapper.META_KEY_PREFIX.formatted("*"))
                .forEach(key -> ids.add(extractRoomId(key)));
        return ids;
    }

    private String extractRoomId(String metaKey) {
        return metaKey.substring(ROOM_PREFIX.length(), metaKey.length() - META_SUFFIX.length());
    }

    private List<String> parseTags(String tags) {
        if (tags == null || tags.isBlank()) {
            return List.of();
        }
        return Arrays.stream(tags.split(","))
                .map(String::trim)
                .filter(tag -> !tag.isEmpty())
                .toList();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
