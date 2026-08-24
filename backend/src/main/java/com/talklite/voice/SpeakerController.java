package com.talklite.voice;

import com.talklite.realtime.RedisMessagePublisher;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;

import java.security.Principal;

@Controller
public class SpeakerController {

    private final RedisMessagePublisher publisher;

    public SpeakerController(RedisMessagePublisher publisher) {
        this.publisher = publisher;
    }

    /**
     * /app/room/{roomId}/speaker → talklite:room:{roomId}:speaker 채널 Relay-Only 발행.
     * 발화자(speakerId)는 Principal 기반.
     */
    @MessageMapping("/room/{roomId}/speaker")
    public void speaker(@DestinationVariable String roomId, @Payload SpeakerRequest body, Principal principal) {
        String speaker = principal == null ? "unknown" : principal.getName();
        publisher.publish(
                "talklite:room:%s:speaker".formatted(roomId),
                new SpeakerEvent(roomId, speaker, body.talking()));
    }
}
