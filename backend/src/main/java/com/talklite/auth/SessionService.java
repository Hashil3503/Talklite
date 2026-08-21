package com.talklite.auth;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

@Service
public class SessionService {

    public static final String SESSION_KEY_PREFIX = "session:%s";
    public static final long TTL_SECONDS = 86400;

    private final StringRedisTemplate redis;

    public SessionService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public SessionResponse create(String user) {
        String token = UUID.randomUUID().toString();
        redis.opsForValue().set(SESSION_KEY_PREFIX.formatted(token), user, Duration.ofSeconds(TTL_SECONDS));
        return new SessionResponse(token, user, TTL_SECONDS);
    }

    /** 토큰이 유효하고 등록된 유저라면 유저 반환, 아니면 null */
    public String resolve(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        return token.startsWith("Bearer ")
                ? redis.opsForValue().get(SESSION_KEY_PREFIX.formatted(token.substring("Bearer ".length()).trim()))
                : null;
    }
}
