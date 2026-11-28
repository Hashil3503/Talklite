package com.talklite.auth;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * 서버 발급 UID ↔ 비밀값(SHA-256 hex) 매핑 MariaDB 저장소.
 * 원문 비밀값은 저장하지 않는다.
 */
@Repository
public class UserCredentialRepository {

    private final JdbcClient jdbc;

    public UserCredentialRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void save(String uid, String secretHash, long createdAt) {
        jdbc.sql("""
                INSERT INTO user_credential (uid, secret_hash, created_at)
                VALUES (:uid, :secretHash, :createdAt)
                """)
                .param("uid", uid)
                .param("secretHash", secretHash)
                .param("createdAt", createdAt)
                .update();
    }

    /** 저장된 SHA-256 hex, 없으면 null */
    public String findSecretHash(String uid) {
        return jdbc.sql("SELECT secret_hash FROM user_credential WHERE uid = :uid")
                .param("uid", uid)
                .query(String.class)
                .optional()
                .orElse(null);
    }
}
