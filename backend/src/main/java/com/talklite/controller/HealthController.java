package com.talklite.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class HealthController {

    /** 애플리케이션 기동 시 한 번 생성되는 인스턴스 식별자 (재기동 감지용) */
    private final String instanceId = UUID.randomUUID().toString();

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> healthCheck() {
        return ResponseEntity.ok(Map.of("status", "ok", "instanceId", instanceId));
    }
}