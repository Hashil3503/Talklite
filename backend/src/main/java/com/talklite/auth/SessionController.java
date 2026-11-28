package com.talklite.auth;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final SessionService sessionService;
    private final UserCredentialRepository credentialRepository;

    public SessionController(SessionService sessionService, UserCredentialRepository credentialRepository) {
        this.sessionService = sessionService;
        this.credentialRepository = credentialRepository;
    }

    @PostMapping
    public SessionResponse create(@RequestBody(required = false) SessionRequest body) {
        String user = body == null ? null : body.user();
        String secret = body == null ? null : body.secret();

        // 발급된 UID + 올바른 비밀값인 경우에만 기존 UID로 토큰 발급
        if (user != null && !user.isBlank() && secret != null && !secret.isBlank()) {
            String storedHash = credentialRepository.findSecretHash(user);
            if (storedHash != null && MessageDigest.isEqual(
                    storedHash.getBytes(StandardCharsets.UTF_8),
                    sessionService.hashSecret(secret).getBytes(StandardCharsets.UTF_8))) {
                return sessionService.create(user);
            }
        }

        // 그 외 모든 경우: 새 UID + 비밀값 발급 (미발급/불일치 UID 대체)
        String uid = sessionService.newUid();
        String issuedSecret = sessionService.newSecret();
        credentialRepository.save(uid, sessionService.hashSecret(issuedSecret), System.currentTimeMillis());
        SessionResponse issued = sessionService.create(uid);
        return new SessionResponse(issued.token(), issued.user(), issued.expiresIn(), issuedSecret);
    }
}
