package com.talklite.auth;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class SessionService {

    public static final String SESSION_KEY_PREFIX = "session:%s";
    public static final long TTL_SECONDS = 86400;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int SECRET_BYTES = 32;

    private final StringRedisTemplate redis;

    public SessionService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public SessionResponse create(String user) {
        String token = UUID.randomUUID().toString();
        String effectiveUser = (user == null || user.isBlank()) ? UUID.randomUUID().toString() : user;
        redis.opsForValue().set(SESSION_KEY_PREFIX.formatted(token), effectiveUser, Duration.ofSeconds(TTL_SECONDS));
        return new SessionResponse(token, effectiveUser, TTL_SECONDS, null);
    }

    /** 서버 발급 UID (기존 클라이언트 UUID 형식 유지) */
    public String newUid() {
        return UUID.randomUUID().toString();
    }

    /** 32바이트 SecureRandom → base64url (패딩 없음) */
    public String newSecret() {
        byte[] bytes = new byte[SECRET_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** 비밀값의 SHA-256 hex (소문자 64자) */
    public String hashSecret(String secret) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(secret.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
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
