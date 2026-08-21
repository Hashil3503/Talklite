package com.talklite.auth;

public record SessionResponse(
        String token,
        String user,
        long expiresIn
) {
}
