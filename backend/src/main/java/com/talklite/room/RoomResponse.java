package com.talklite.room;

import java.util.List;

public record RoomResponse(
        String id,
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
        return new RoomResponse(
                room.id(),
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
