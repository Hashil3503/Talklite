package com.talklite.room;

import com.talklite.realtime.RoomEventPublisher;
import com.talklite.realtime.RoomSessionRegistry;
import org.springframework.stereotype.Service;

import java.util.List;

import static com.talklite.realtime.RoomEventPublisher.LOBBY_ROOM_UPDATE;
import static com.talklite.realtime.RoomEventPublisher.ROOM_EVENT_KICKED;

@Service
public class KickService {

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;
    private final PermanentRoomBanRepository permanentRoomBanRepository;
    private final RoomSessionRegistry roomSessionRegistry;

    public KickService(RoomMapper roomMapper, RoomEventPublisher eventPublisher,
                       PermanentRoomBanRepository permanentRoomBanRepository,
                       RoomSessionRegistry roomSessionRegistry) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
        this.permanentRoomBanRepository = permanentRoomBanRepository;
        this.roomSessionRegistry = roomSessionRegistry;
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
            // 임시 강퇴는 Redis TTL 키만 사용 (영구 방이라도 DB 영속화하지 않는다)
            roomMapper.temporaryBan(roomId, request.targetUser());
        } else {
            roomMapper.permanentBan(roomId, request.targetUser());
            if (room.type() == RoomType.PERMANENT) {
                // 영구 방의 영구 강퇴는 재기동 후에도 유지되어야 하므로 MariaDB에 영속화
                permanentRoomBanRepository.save(roomId, request.targetUser());
            }
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
        List<String> members = roomMapper.members(roomId);
        return RoomResponse.from(room, members, null, roomMapper.voiceCount(roomId),
                roomSessionRegistry.offlineMembers(roomId, members));
    }
}
