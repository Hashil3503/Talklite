package com.talklite.room;

import java.util.List;

public record Room(
        String id,
        String game,
        List<String> tags,
        int capacity,
        RoomScope scope,
        RoomType type,
        String host,
        long createdAt
) {
}
