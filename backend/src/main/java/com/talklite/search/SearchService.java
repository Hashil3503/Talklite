package com.talklite.search;

import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
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

    /** P0-05: 3x2 복합 정렬 검색 엔진. sort=latest|title|members, order=asc|desc, 기본값 latest/desc */
    public List<RoomResponse> search(String game, String tags, String sort, String order) {
        String sortKey = normalizeSort(sort);
        boolean desc = normalizeOrder(order);

        List<String> tagList = parseTags(tags);
        Set<String> roomIds = candidateRoomIds(game, tagList);

        List<Room> rooms = roomIds.stream()
                .map(roomMapper::find)
                .filter(Objects::nonNull)
                .filter(room -> room.scope() == RoomScope.PUBLIC)
                .toList();

        // 멤버 목록을 1회 조회 후 재사용 (N+1 완화, 정렬 키 + 응답 공용)
        Map<String, List<String>> membersByRoom = new HashMap<>();
        for (Room room : rooms) {
            membersByRoom.put(room.id(), roomMapper.members(room.id()));
        }

        Comparator<Room> primary = switch (sortKey) {
            case "title" -> Comparator.comparing(
                    (Room r) -> r.title() == null ? "" : r.title(),
                    String.CASE_INSENSITIVE_ORDER);
            case "members" -> Comparator.comparingInt((Room r) -> membersByRoom.get(r.id()).size());
            default -> Comparator.comparingLong(Room::createdAt);
        };
        if (desc) {
            primary = primary.reversed();
        }

        // 조건부 2차 결정적 키: 1차가 latest면 id asc, 1차가 title/members면 createdAt desc, id asc
        Comparator<Room> secondary = switch (sortKey) {
            case "latest" -> Comparator.comparing(Room::id);
            default -> Comparator.comparingLong(Room::createdAt).reversed().thenComparing(Room::id);
        };

        return rooms.stream()
                .sorted(primary.thenComparing(secondary))
                .limit(LIMIT)
                .map(room -> RoomResponse.from(room, membersByRoom.get(room.id()), room.title()))
                .toList();
    }

    /** 화이트리스트: latest|title|members (대소문자 무시), 위반 시 400 invalid_sort */
    private String normalizeSort(String sort) {
        String normalized = sort == null ? "latest" : sort.trim().toLowerCase();
        if (!normalized.equals("latest") && !normalized.equals("title") && !normalized.equals("members")) {
            throw new InvalidSearchParamException("invalid_sort", "sort must be latest|title|members");
        }
        return normalized;
    }

    /** 화이트리스트: asc|desc (대소문자 무시), 위반 시 400 invalid_order. 기본값 desc */
    private boolean normalizeOrder(String order) {
        String normalized = order == null ? "desc" : order.trim().toLowerCase();
        if (!normalized.equals("asc") && !normalized.equals("desc")) {
            throw new InvalidSearchParamException("invalid_order", "order must be asc|desc");
        }
        return normalized.equals("desc");
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
        Set<String> intersect = redis.opsForSet().intersect(keys);
        return intersect == null ? Set.of() : intersect;
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