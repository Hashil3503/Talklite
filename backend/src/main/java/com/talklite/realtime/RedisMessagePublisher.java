package com.talklite.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
public class RedisMessagePublisher {

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RedisMessagePublisher(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /**
     * Relay-Only 규약: 이벤트는 오직 Redis Pub/Sub 채널로만 발행한다.
     * STOMP 브로드캐스트는 RedisMessageSubscriber가 단독 수행 (이중 발송 원천 차단).
     */
    public void publish(String channel, Object payload) {
        String body;
        try {
            body = objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("failed to serialize event payload", e);
        }
        redis.convertAndSend(channel, body);
    }
}
