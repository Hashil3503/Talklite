package com.talklite.realtime;

import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * Redis Pub/Sub 수신의 유일한 소비자 — STOMP 브로드캐스트(SimpMessagingTemplate) 호출은
 * 오직 이 클래스에서만 수행한다 (Relay-Only 규약).
 */
@Component
public class RedisMessageSubscriber implements MessageListener {

    public static final String CHAT_PREFIX = "talklite:room:";
    public static final String CHAT_SUFFIX = ":chat";
    public static final String EVENTS_SUFFIX = ":events";
    public static final String SPEAKER_SUFFIX = ":speaker";
    public static final String SIGNAL_MIDDLE = ":signal:";
    public static final String LOBBY_CHANNEL = "talklite:lobby";

    private final SimpMessagingTemplate messagingTemplate;

    public RedisMessageSubscriber(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
        dispatch(channel, new String(message.getBody(), StandardCharsets.UTF_8));
    }

    private void dispatch(String channel, String payload) {
        if (LOBBY_CHANNEL.equals(channel)) {
            messagingTemplate.convertAndSend("/topic/lobby", payload);
            return;
        }
        if (!channel.startsWith(CHAT_PREFIX)) {
            return;
        }
        String rest = channel.substring(CHAT_PREFIX.length());
        if (rest.endsWith(EVENTS_SUFFIX)) {
            String roomId = rest.substring(0, rest.length() - EVENTS_SUFFIX.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId, payload);
        } else if (rest.endsWith(CHAT_SUFFIX)) {
            String roomId = rest.substring(0, rest.length() - CHAT_SUFFIX.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/chat", payload);
        } else if (rest.endsWith(SPEAKER_SUFFIX)) {
            String roomId = rest.substring(0, rest.length() - SPEAKER_SUFFIX.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/speaker", payload);
        } else if (rest.contains(SIGNAL_MIDDLE)) {
            int idx = rest.indexOf(SIGNAL_MIDDLE);
            String roomId = rest.substring(0, idx);
            String targetId = rest.substring(idx + SIGNAL_MIDDLE.length());
            messagingTemplate.convertAndSend("/topic/room/" + roomId + "/signal/" + targetId, payload);
        }
    }
}
