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
    public static final String ROOM_EVENT_DESTROYED = "ROOM_DESTROYED";
    public static final String ROOM_EVENT_UPDATED = "ROOM_UPDATED";
    public static final String LOBBY_ROOM_UPDATE = "ROOM_UPDATE";
    public static final String LOBBY_VOICE_BADGE = "VOICE_BADGE_UPDATE";
    public static final String LOBBY_ROOM_REMOVED = "ROOM_REMOVED";

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

    /** 방장 전용 방 폭파 시 방 내부 참여자 대상 강제 퇴장 이벤트 발행 */
    public void publishRoomDestroyed(Room room, String actor) {
        RoomEvent event = new RoomEvent(
                ROOM_EVENT_DESTROYED, room.id(), actor, null,
                0, room.capacity(), room.host(),
                0, java.util.List.of(),
                System.currentTimeMillis(), Map.of()
        );
        publisher.publish("talklite:room:%s:events".formatted(room.id()), event);
    }

    /** 영구방 파기 시 로비 ROOM_REMOVED 발행 (0명 스냅샷) */
    public void publishRoomRemoved(Room room) {
        publisher.publish("talklite:lobby",
                new LobbyEvent(LOBBY_ROOM_REMOVED, room.id(), room.game(),
                        0, room.capacity(), false, 0, System.currentTimeMillis()));
    }

    /** Phase 11: 방 정보 수정 실시간 전파 — 방 내부 + 로비 2중 브로드캐스트 */
    public void publishRoomUpdated(Room room, String actor, String title, String game,
                                   java.util.List<String> tags, int capacity, long timestamp) {
        Map<String, Object> data = new java.util.HashMap<>();
        if (title != null) data.put("title", title);
        if (game != null) data.put("game", game);
        if (tags != null) data.put("tags", tags);
        data.put("capacity", capacity);
        RoomEvent event = new RoomEvent(
                ROOM_EVENT_UPDATED, room.id(), actor, null,
                roomMapper.members(room.id()).size(), capacity, room.host(),
                roomMapper.voiceCount(room.id()), roomMapper.voiceMembers(room.id()),
                timestamp, data
        );
        publisher.publish("talklite:room:%s:events".formatted(room.id()), event);
        // 로비에도 동일 이벤트 전파 (LobbyEvent 호환 + ROOM_UPDATED 타입)
        publisher.publish("talklite:lobby", event);
        // 기존 LOBBY_ROOM_UPDATE도 함께 전파해 구형 리스너 호환 유지
        publishLobby(LOBBY_ROOM_UPDATE, room);
    }
}
