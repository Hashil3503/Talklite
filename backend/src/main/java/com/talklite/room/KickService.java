package com.talklite.room;

import com.talklite.realtime.RoomEventPublisher;
import org.springframework.stereotype.Service;

import static com.talklite.realtime.RoomEventPublisher.LOBBY_ROOM_UPDATE;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_KICKED;

@Service
public class KickService {

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;

    public KickService(RoomMapper roomMapper, RoomEventPublisher eventPublisher) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
    }

    public RoomResponse kick(String roomId, KickRequest request, String principal) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        // DEF-01: principal이 방장인지 검증 — Body actor 스푸핑 차단
        if (!room.host().equals(principal)) {
            throw new UnauthorizedHostException();
        }
        // Body actor와 principal 불일치도 차단
        if (!principal.equals(request.actor())) {
            throw new UnauthorizedHostException();
        }
        if (room.host().equals(request.targetUser())) {
            throw new InvalidKickException();
        }
        if (!roomMapper.members(roomId).contains(request.targetUser())) {
            throw new InvalidKickException();
        }
        if (request.type() == KickType.TEMPORARY) {
            roomMapper.temporaryBan(roomId, request.targetUser());
        } else {
            roomMapper.permanentBan(roomId, request.targetUser());
        }
        roomMapper.removeMember(roomId, request.targetUser());
        roomMapper.removeVoice(roomId, request.targetUser());
        eventPublisher.roomEvent(ROOM_EVENT_KICKED, room, request.actor(), request.targetUser());
        Room current = roomMapper.find(roomId);
        if (current != null) {
            eventPublisher.publishLobby(LOBBY_ROOM_UPDATE, current);
        }
        return read(roomId);
    }

    /** 하위호환: principal 없이 호출되는 경우 actor 기준으로 위임 */
    public RoomResponse kick(String roomId, KickRequest request) {
        return kick(roomId, request, request.actor());
    }

    private RoomResponse read(String roomId) {
        Room room = roomMapper.find(roomId);
        return RoomResponse.from(room, roomMapper.members(roomId));
    }
}
