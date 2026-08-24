package com.talklite.realtime;

import java.util.List;
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
        List<String> voiceMembers,
        long timestamp,
        Map<String, Object> data
) {
}
