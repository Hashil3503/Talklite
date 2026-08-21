package com.talklite.chat;

public record ChatMessage(
        String messageId,
        String clientRequestId,
        String roomId,
        String sender,
        String senderName,
        String content,
        long timestamp,
        String type
) {
}
