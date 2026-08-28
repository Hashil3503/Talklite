package com.talklite.chat;

import java.util.List;

public record SendChatRequest(
        String clientRequestId,
        String content,
        String type,
        String mediaUrl,
        List<String> mentions
) {
    // 2-arg legacy constructor for existing tests / STOMP clients that only send content
    public SendChatRequest(String clientRequestId, String content) {
        this(clientRequestId, content, null, null, null);
    }
}
