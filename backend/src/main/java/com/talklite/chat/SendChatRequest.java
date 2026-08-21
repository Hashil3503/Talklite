package com.talklite.chat;

public record SendChatRequest(
        String clientRequestId,
        String content
) {
}
