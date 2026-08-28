package com.talklite.realtime;

import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;

/**
 * DEF-03: 새로고침/비정상 종료 시 WebSocket 연결 단절(Presence) 리스너.
 * SessionDisconnectEvent 발생 시 STOMP SessionAttributes에 저장된 roomId/user를 꺼내
 * 음성 참여 상태를 정리하고 VOICE_STATUS_CHANGED 이벤트를 발행한다.
 */
@Component
public class PresenceEventListener {

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;

    public PresenceEventListener(RoomMapper roomMapper, RoomEventPublisher eventPublisher) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attrs = accessor.getSessionAttributes();
        String roomId = null;
        String user = null;

        if (attrs != null) {
            roomId = (String) attrs.get("roomId");
            user = (String) attrs.get("user");
        }

        // fallback: Principal 기반 user 복원
        if (user == null && accessor.getUser() != null) {
            user = accessor.getUser().getName();
        }
        if (user == null && event.getUser() != null) {
            user = event.getUser().getName();
        }

        if (roomId == null || user == null) {
            return;
        }

        Room room = roomMapper.find(roomId);
        if (room == null) {
            return;
        }

        roomMapper.removeVoice(roomId, user);
        // voiceCount 변경을 반영한 VOICE_STATUS_CHANGED 발행 (lobby badge 포함)
        // wasMember 여부와 무관하게 발행하면 불필요한 이벤트 폭증 가능하므로 wasMember일 때만 발행하거나 항상 발행 중 선택.
        // Spec: removeVoice 후 VOICE_STATUS_CHANGED 발행 → 항상 정리 시도 후 발행
        Room current = roomMapper.find(roomId);
        if (current != null) {
            eventPublisher.publishVoice(current, user);
        } else {
            // room이 GC 등으로 사라진 직후라도 voiceCount는 0으로 간주하여 이벤트 발행
            eventPublisher.publishVoice(room, user);
        }
    }
}
