package com.talklite.signaling;

import com.talklite.realtime.RedisMessagePublisher;
import com.talklite.room.RoomMapper;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;

import java.security.Principal;

@Controller
public class SignalController {

    private final RedisMessagePublisher publisher;
    private final RoomMapper roomMapper;

    public SignalController(RedisMessagePublisher publisher, RoomMapper roomMapper) {
        this.publisher = publisher;
        this.roomMapper = roomMapper;
    }

    /**
     * /app/room/{roomId}/signal → talklite:room:{roomId}:signal:{to} 채널로 Relay-Only 발행.
     * 발신자는 Principal 기반(스푸핑 불가), 타겟이 방 멤버일 때만 중계한다.
     */
    @MessageMapping("/room/{roomId}/signal")
    public void signal(@DestinationVariable String roomId, @Payload SignalMessage message, Principal principal) {
        String from = principal == null ? null : principal.getName();
        if (from == null || message == null || message.to() == null || message.to().isBlank() || message.type() == null) {
            return;
        }
        if (!roomMapper.members(roomId).contains(message.to())) {
            return;
        }
        publisher.publish(
                "talklite:room:%s:signal:%s".formatted(roomId, message.to()),
                new SignalMessage(from, message.to(), message.type(), message.sdp(), message.candidate()));
    }
}
