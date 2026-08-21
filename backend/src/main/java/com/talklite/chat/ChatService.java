package com.talklite.chat;

import com.talklite.realtime.RoomEventPublisher;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class ChatService {

    public static final String TYPE_TALK = "TALK";

    private final RoomEventPublisher eventPublisher;

    public ChatService(RoomEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    /**
     * 발신자는 클라이언트 페이로드가 아닌 Principal(인증 세션) 기반.
     */
    public void send(String roomId, String sender, SendChatRequest request) {
        String content = request.content() == null ? "" : request.content().trim();
        if (content.isEmpty() || content.length() > 500) {
            return;
        }
        ChatMessage message = new ChatMessage(
                "msg-" + UUID.randomUUID(),
                request.clientRequestId(),
                roomId,
                sender,
                sender,
                content,
                System.currentTimeMillis(),
                TYPE_TALK
        );
        eventPublisher.chat(roomId, message);
    }
}
