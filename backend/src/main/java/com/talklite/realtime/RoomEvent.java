package com.talklite.realtime;

import java.util.Map;

public record RoomEvent(
        String type,
        String roomId,
        String actor,
        String targetUser,
        int memberCount,
        int capacity,
        String host,
        int voiceCount,
        long timestamp,
        Map<String, Object> data
) {
}
