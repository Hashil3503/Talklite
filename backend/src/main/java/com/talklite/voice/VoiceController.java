package com.talklite.voice;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.security.Principal;

@Controller
public class VoiceController {

    private final VoiceService voiceService;

    public VoiceController(VoiceService voiceService) {
        this.voiceService = voiceService;
    }

    @MessageMapping("/room/{roomId}/voice/start")
    public void voiceStart(@DestinationVariable String roomId, Principal principal) {
        voiceService.start(roomId, principal.getName());
    }

    @MessageMapping("/room/{roomId}/voice/end")
    public void voiceEnd(@DestinationVariable String roomId, Principal principal) {
        voiceService.end(roomId, principal.getName());
    }
}
