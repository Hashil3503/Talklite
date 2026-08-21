package com.talklite.realtime;

public record LobbyEvent(
        String type,
        String roomId,
        String game,
        int memberCount,
        int capacity,
        boolean voiceActive,
        int voiceCount,
        long timestamp
) {
}
