package com.talklite.realtime;

import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * Redis Pub/Sub 수신의 유일한 소비자 — STOMP 브로드캐스트(SimpMessagingTemplate) 호출은
 * 오직 이 클래스에서만 수행한다 (Relay-Only 패턴, 채널 → /topic 1:1 매핑).
 */
@Component
public class RedisMessageSubscriber implements MessageListener {

    public static final String CHAT_PREFIX = "talklite:room:";
    public static final String CHAT_SUFFIX = ":chat";
    public static final String EVENTS_SUFFIX = ":events";
    public static final String LOBBY_CHANNEL = "talklite:lobby";

    private final SimpMessagingTemplate messagingTemplate;

    public RedisMessageSubscriber(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
        String payload = new String(message.getBody(), StandardCharsets.UTF_8);
        if (channel.equals(LOBBY_CHANNEL)) {
            messagingTemplate.convertAndSend("/topic/lobby", payload);
        } else if (channel.startsWith(CHAT_PREFIX) && channel.endsWith(CHAT_SUFFIX)) {
            String roomId = channel.substring(CHAT_PREFIX.length(), channel.length() - CHAT_SUFFIX.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/chat", payload);
        } else if (channel.startsWith(CHAT_PREFIX) && channel.endsWith(EVENTS_SUFFIX)) {
            String roomId = channel.substring(CHAT_PREFIX.length(), channel.length() - EVENTS_SUFFIX.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId, payload);
        }
    }
}
