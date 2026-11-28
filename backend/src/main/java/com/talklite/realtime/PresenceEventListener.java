package com.talklite.realtime;

import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomNotFoundException;
import com.talklite.room.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

/**
 * DEF-03: 새로고침/비정상 종료 시 WebSocket 연결 단절(Presence) 리스너.
 * SessionDisconnectEvent 발생 시 STOMP SessionAttributes에 저장된 roomId/user를 꺼내
 * 음성 참여 상태를 정리하고 VOICE_STATUS_CHANGED 이벤트를 발행한다.
 *
 * T-H4: 연결이 끊긴 사용자를 곧바로 방에서 내보내지 않고 유예 시간(DISCONNECT_GRACE_SECONDS) 뒤에
 * 해당 방을 구독 중인 live 세션이 하나도 없을 때만 일반 퇴장(RoomService.leave)과 동일하게 처리한다.
 */
@Component
public class PresenceEventListener {

    private static final Logger log = LoggerFactory.getLogger(PresenceEventListener.class);

    /** 새로고침/재연결 유예 시간(초). 테스트에서는 프로퍼티로 단축한다. */
    public static final long DISCONNECT_GRACE_SECONDS = 30;

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;
    private final RoomService roomService;
    private final RoomSessionRegistry roomSessionRegistry;
    private final TaskScheduler taskScheduler;
    private final long graceSeconds;

    public PresenceEventListener(RoomMapper roomMapper,
                                 RoomEventPublisher eventPublisher,
                                 RoomService roomService,
                                 RoomSessionRegistry roomSessionRegistry,
                                 TaskScheduler taskScheduler,
                                 @Value("${talklite.presence.grace-seconds:" + DISCONNECT_GRACE_SECONDS + "}") long graceSeconds) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
        this.roomService = roomService;
        this.roomSessionRegistry = roomSessionRegistry;
        this.taskScheduler = taskScheduler;
        this.graceSeconds = graceSeconds;
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

        // 방 토픽을 구독했던 세션만 퇴장 유예 대상 (시그널 전용 세션은 제외)
        Set<String> trackedRooms = trackedRooms(attrs);

        // live 세션 추적 해제 (방 토픽 SUBSCRIBE 시 등록한 세션만)
        String sessionId = event.getSessionId();
        if (sessionId != null) {
            for (String tracked : trackedRooms) {
                roomSessionRegistry.remove(tracked, user, sessionId);
            }
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

        for (String tracked : trackedRooms) {
            scheduleMembershipCheck(tracked, user);
        }
    }

    @SuppressWarnings("unchecked")
    private Set<String> trackedRooms(Map<String, Object> attrs) {
        if (attrs == null) {
            return Set.of();
        }
        Object tracked = attrs.get("roomSubscriptions");
        return tracked instanceof Set<?> set
                ? Set.copyOf((Set<String>) set)
                : Set.of();
    }

    /** 유예 시간 후에도 다른 live 세션이 없으면 일반 퇴장과 동일하게 방에서 제거한다. */
    private void scheduleMembershipCheck(String roomId, String user) {
        taskScheduler.schedule(() -> {
            try {
                if (roomSessionRegistry.count(roomId, user) > 0) {
                    return; // 유예 시간 내 재접속/재구독 → 아무것도 하지 않음
                }
                Room room = roomMapper.find(roomId);
                if (room == null || !roomMapper.members(roomId).contains(user)) {
                    return; // 방이 이미 사라졌거나 사용자가 이미 퇴장함
                }
                roomService.leave(roomId, user);
            } catch (RoomNotFoundException ignored) {
                // 유예 시간 사이 방이 파기된 경우는 정상 흐름
            } catch (Exception e) {
                log.warn("presence grace leave failed for room={} user={}", roomId, user, e);
            }
        }, Instant.now().plusSeconds(graceSeconds));
    }
}
