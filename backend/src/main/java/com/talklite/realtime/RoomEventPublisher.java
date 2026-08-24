package com.talklite.realtime;

import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 방/로비 실시간 이벤트 발행 헬퍼 — RedisMessagePublisher(Relay-Only)로만 발행한다.
 * (STOMP 브로드캐스트는 RedisMessageSubscriber 단독 수행)
 */
@Component
public class RoomEventPublisher {

    public static final String ROOM_EVENT_JOIN = "MEMBER_JOIN";
    public static final String ROOM_EVENT_LEAVE = "MEMBER_LEAVE";
    public static final String ROOM_EVENT_HOST_MIGRATED = "HOST_MIGRATED";
    public static final String ROOM_EVENT_KICKED = "MEMBER_KICKED";
    public static final String ROOM_EVENT_VOICE = "VOICE_STATUS_CHANGED";
    public static final String LOBBY_ROOM_UPDATE = "ROOM_UPDATE";
    public static final String LOBBY_VOICE_BADGE = "VOICE_BADGE_UPDATE";

    private final RedisMessagePublisher publisher;
    private final RoomMapper roomMapper;

    public RoomEventPublisher(RedisMessagePublisher publisher, RoomMapper roomMapper) {
        this.publisher = publisher;
        this.roomMapper = roomMapper;
    }

    public RoomEvent roomEvent(String type, Room room, String actor, String targetUser) {
        RoomEvent event = new RoomEvent(
                type, room.id(), actor, targetUser,
                roomMapper.members(room.id()).size(), room.capacity(), room.host(),
                roomMapper.voiceCount(room.id()), roomMapper.voiceMembers(room.id()),
                System.currentTimeMillis(), Map.of()
        );
        publisher.publish("talklite:room:%s:events".formatted(room.id()), event);
        return event;
    }

    public void publishVoice(Room room, String actor) {
        roomEvent(ROOM_EVENT_VOICE, room, actor, null);
        publishLobby(LOBBY_VOICE_BADGE, room);
    }

    public void publishLobby(String type, Room room) {
        int voiceCount = roomMapper.voiceCount(room.id());
        LobbyEvent event = new LobbyEvent(
                type, room.id(), room.game(),
                roomMapper.members(room.id()).size(), room.capacity(),
                voiceCount > 0, voiceCount, System.currentTimeMillis()
        );
        publisher.publish("talklite:lobby", event);
    }

    public void chat(String roomId, Object message) {
        publisher.publish("talklite:room:%s:chat".formatted(roomId), message);
    }
}
