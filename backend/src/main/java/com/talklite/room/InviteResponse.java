package com.talklite.room;

public record InviteResponse(
        String code,
        String roomId,
        long expiresInSeconds
) {
}
