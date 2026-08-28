package com.talklite.chat;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChatMessage(
        String messageId,
        String clientRequestId,
        String roomId,
        String sender,
        String senderName,
        String content,
        long timestamp,
        String type,
        String mediaUrl,
        List<String> mentions
) {
    public ChatMessage {
        if (mentions == null) mentions = List.of();
    }

    // backward-compatible 8-arg constructor for legacy call sites
    public ChatMessage(String messageId, String clientRequestId, String roomId,
                       String sender, String senderName, String content,
                       long timestamp, String type) {
        this(messageId, clientRequestId, roomId, sender, senderName, content, timestamp, type, null, List.of());
    }
}
