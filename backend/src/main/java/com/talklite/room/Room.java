package com.talklite.room;

import java.util.List;

public record Room(
        String id,
        String title,
        String game,
        List<String> tags,
        int capacity,
        RoomScope scope,
        RoomType type,
        String host,
        long createdAt
) {
    /** 8-arg 하위 호환 생성자 — title 미지정 시 null (P0-03 원자 계약) */
    public Room(String id, String game, List<String> tags, int capacity, RoomScope scope, RoomType type, String host, long createdAt) {
        this(id, null, game, tags, capacity, scope, type, host, createdAt);
    }
}
