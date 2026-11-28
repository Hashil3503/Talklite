package com.talklite.realtime;

import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomNotFoundException;
import com.talklite.room.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * 서버 재기동 시 RoomSessionRegistry(인메모리)가 비어 있으므로, 서버가 내려가 있는 동안 탭을 닫은
 * 멤버는 DISCONNECT 이벤트도 유예 타이머도 없이 영원히 남는다.
 *
 * ApplicationReadyEvent에서 유예 시간 + 5초(클라이언트 STOMP 재연결 지연 5초) 뒤 한 번 스윕하여
 * live 세션이 없는 멤버를 일반 퇴장(RoomService.leave)과 동일하게 정리한다.
 */
@Component
public class StartupMembershipSweeper {

    private static final Logger log = LoggerFactory.getLogger(StartupMembershipSweeper.class);

    private final RoomMapper roomMapper;
    private final RoomService roomService;
    private final RoomSessionRegistry roomSessionRegistry;
    private final TaskScheduler taskScheduler;
    private final long sweepDelaySeconds;

    public StartupMembershipSweeper(RoomMapper roomMapper,
                                    RoomService roomService,
                                    RoomSessionRegistry roomSessionRegistry,
                                    TaskScheduler taskScheduler,
                                    @Value("${talklite.presence.startup-sweep-seconds:-1}") long configuredSweepSeconds,
                                    @Value("${talklite.presence.grace-seconds:" + PresenceEventListener.DISCONNECT_GRACE_SECONDS + "}") long graceSeconds) {
        this.roomMapper = roomMapper;
        this.roomService = roomService;
        this.roomSessionRegistry = roomSessionRegistry;
        this.taskScheduler = taskScheduler;
        // 프로퍼티 미지정(-1) 시 유예 시간 + 5초 (클라이언트 재연결 지연 5초) = 15초
        this.sweepDelaySeconds = configuredSweepSeconds >= 0 ? configuredSweepSeconds : graceSeconds + 5;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void scheduleStartupSweep() {
        taskScheduler.schedule(this::sweep, Instant.now().plusSeconds(sweepDelaySeconds));
    }

    /** Redis의 모든 방에서 live STOMP 세션이 없는 멤버를 퇴장 처리한다. */
    public void sweep() {
        for (String roomId : roomMapper.roomIds()) {
            Room room = roomMapper.find(roomId);
            if (room == null) {
                continue; // 스캔과 조회 사이에 파기된 방
            }
            for (String member : List.copyOf(roomMapper.members(roomId))) {
                if (roomSessionRegistry.count(roomId, member) > 0) {
                    continue;
                }
                try {
                    roomService.leave(roomId, member);
                } catch (RoomNotFoundException ignored) {
                    // 방이 이미 파기된 경우는 정상 흐름
                } catch (Exception e) {
                    log.warn("startup membership sweep leave failed for room={} user={}", roomId, member, e);
                }
            }
        }
    }
}
