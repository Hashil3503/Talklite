package com.talklite.room;

import java.util.List;

public record RoomResponse(
        String id,
        String title,
        String game,
        List<String> tags,
        int capacity,
        RoomScope scope,
        RoomType type,
        String host,
        long createdAt,
        int count,
        List<String> members
) {
    public static RoomResponse from(Room room, List<String> members) {
        return from(room, members, null);
    }

    public static RoomResponse from(Room room, List<String> members, String title) {
        return new RoomResponse(
                room.id(),
                title,
                room.game(),
                room.tags(),
                room.capacity(),
                room.scope(),
                room.type(),
                room.host(),
                room.createdAt(),
                members.size(),
                members
        );
    }
}
