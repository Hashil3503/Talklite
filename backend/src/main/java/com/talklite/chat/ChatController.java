package com.talklite.chat;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;

import java.security.Principal;

@Controller
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @MessageMapping("/room/{roomId}/chat")
    public void chat(@DestinationVariable String roomId, @Payload SendChatRequest body, Principal principal) {
        String sender = principal == null ? "unknown" : principal.getName();
        chatService.send(roomId, sender, body);
    }
}
