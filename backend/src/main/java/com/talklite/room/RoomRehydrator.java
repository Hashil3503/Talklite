package com.talklite.room;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 기동 시 영구 방(PERMANENT) Re-hydration (FR-ROOM-03, T-06).
 * MariaDB permanent_room의 모든 영구 방 메타를 Redis에 0명 상태로 복원(restore)한다.
 * Redis는 `--save ""` 순수 인메모리이므로 재기동 시 비워져 있어 멱등 복원됨.
 */
@Component
public class RoomRehydrator {

    private final PermanentRoomRepository repository;
    private final RoomMapper roomMapper;

    public RoomRehydrator(PermanentRoomRepository repository, RoomMapper roomMapper) {
        this.repository = repository;
        this.roomMapper = roomMapper;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void rehydrate() {
        for (Room room : repository.findAll()) {
            roomMapper.restore(room);
        }
    }
}
