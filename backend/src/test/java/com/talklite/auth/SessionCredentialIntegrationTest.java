package com.talklite.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class SessionCredentialIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private org.springframework.jdbc.core.simple.JdbcClient jdbc;

    private JsonNode createSession(String body) throws Exception {
        String json = mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(json);
    }

    @Test
    @DisplayName("T-H1-01: 본문 없는 세션 요청은 서버 발급 UID + 비밀값을 반환한다")
    void sessionWithoutBodyIssuesUidAndSecret() throws Exception {
        JsonNode issued = createSession("{}");

        assertNotNull(issued.get("token"));
        String uid = issued.get("user").asText();
        String secret = issued.get("secret").asText();
        assertFalse(uid.isBlank(), "서버가 UID를 발급한다");
        assertFalse(secret.isBlank(), "신규 발급 시 비밀값을 반환한다");
        assertTrue(issued.get("expiresIn").asLong() > 0);
    }

    @Test
    @DisplayName("T-H1-02: 동일 UID + 올바른 비밀값은 같은 UID로 토큰을 발급하고 비밀값은 반환하지 않는다")
    void correctSecretKeepsSameUid() throws Exception {
        JsonNode issued = createSession("{}");
        String uid = issued.get("user").asText();
        String secret = issued.get("secret").asText();

        JsonNode again = createSession(objectMapper.writeValueAsString(Map.of("user", uid, "secret", secret)));

        assertEquals(uid, again.get("user").asText(), "동일 UID 유지");
        assertNotNull(again.get("token"));
        assertTrue(again.get("secret") == null || again.get("secret").isNull(), "재사용 시 비밀값 미반환");
        assertNotEquals(issued.get("token").asText(), again.get("token").asText(), "호출마다 새 토큰");
    }

    @Test
    @DisplayName("T-H1-03: 남의 UID를 비밀값 없이/틀린 비밀값으로 요청하면 다른 UID가 발급된다")
    void otherUidWithMissingOrWrongSecretIsReplaced() throws Exception {
        JsonNode issued = createSession("{}");
        String victimUid = issued.get("user").asText();

        JsonNode noSecret = createSession(objectMapper.writeValueAsString(Map.of("user", victimUid)));
        assertNotEquals(victimUid, noSecret.get("user").asText(), "비밀값 없이는 같은 UID 토큰 불가");
        assertFalse(noSecret.get("secret").asText().isBlank(), "새 비밀값 발급");

        JsonNode wrongSecret = createSession(objectMapper.writeValueAsString(
                Map.of("user", victimUid, "secret", "wrong-secret-value")));
        assertNotEquals(victimUid, wrongSecret.get("user").asText(), "틀린 비밀값으로는 같은 UID 토큰 불가");
        assertFalse(wrongSecret.get("secret").asText().isBlank(), "새 비밀값 발급");
    }

    @Test
    @DisplayName("T-H1-04: 발급된 적 없는 UID는 다른 UID로 대체된다")
    void neverIssuedUidIsReplaced() throws Exception {
        JsonNode issued = createSession(objectMapper.writeValueAsString(
                Map.of("user", "never-issued-uid-1234", "secret", "some-secret")));

        assertNotEquals("never-issued-uid-1234", issued.get("user").asText());
        assertFalse(issued.get("secret").asText().isBlank());
    }

    @Test
    @DisplayName("T-H1-05: 비밀값은 SHA-256 hex로만 저장된다")
    void secretStoredAsSha256Hex() throws Exception {
        JsonNode issued = createSession("{}");
        String uid = issued.get("user").asText();
        String secret = issued.get("secret").asText();

        String stored = jdbcSecretHash(uid);
        assertNotNull(stored, "발급 UID의 자격 증명이 저장된다");
        assertEquals(64, stored.length(), "SHA-256 hex 64자");
        assertTrue(stored.matches("[0-9a-f]{64}"), "소문자 hex");
        assertNotEquals(secret, stored, "원문 비밀값은 저장하지 않는다");
        assertEquals(sessionService.hashSecret(secret), stored, "저장값은 원문의 SHA-256");
    }

    private String jdbcSecretHash(String uid) {
        return jdbc.sql("SELECT secret_hash FROM user_credential WHERE uid = :uid")
                .param("uid", uid)
                .query(String.class)
                .optional()
                .orElse(null);
    }
}
