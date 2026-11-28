package com.talklite.config;

import com.talklite.auth.SessionService;
import com.talklite.realtime.RoomEventPublisher;
import com.talklite.realtime.RoomSessionRegistry;
import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP 사전 인증/인가 (NFR-SEC-01, NFR-SEC-02).
 * - CONNECT: Authorization: Bearer <token> → SessionService 검증 → StompPrincipal 등록 (미인증 시 연결 거부)
 * - SUBSCRIBE: 허용된 토픽 화이트리스트만 구독 허용, 방 토픽은 비공개 방 멤버십 인가 검증
 */
@Component
public class WebSocketAuthInterceptor implements ChannelInterceptor {

    /** {roomId} 세그먼트: *, / 를 포함하지 않는 1자 이상 */
    private static final String ROOM_SEGMENT = "([^*/]+)";
    /** {uid} 세그먼트: *, / 를 포함하지 않는 1자 이상 */
    private static final String UID_SEGMENT = "([^*/]+)";

    private static final Pattern LOBBY_TOPIC = Pattern.compile("/topic/lobby");
    private static final Pattern ROOM_TOPIC =
            Pattern.compile("/topic/room/" + ROOM_SEGMENT + "(?:/(?:chat|speaker))?");
    private static final Pattern SIGNAL_TOPIC =
            Pattern.compile("/topic/room/" + ROOM_SEGMENT + "/signal/" + UID_SEGMENT);

    private final SessionService sessionService;
    private final RoomMapper roomMapper;
    private final RoomSessionRegistry roomSessionRegistry;
    private final RoomEventPublisher roomEventPublisher;

    public WebSocketAuthInterceptor(SessionService sessionService, RoomMapper roomMapper,
                                    RoomSessionRegistry roomSessionRegistry,
                                    RoomEventPublisher roomEventPublisher) {
        this.sessionService = sessionService;
        this.roomMapper = roomMapper;
        this.roomSessionRegistry = roomSessionRegistry;
        this.roomEventPublisher = roomEventPublisher;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) {
            return message;
        }
        if (accessor.getCommand() == StompCommand.CONNECT) {
            List<String> auth = accessor.getNativeHeader("Authorization");
            String token = (auth == null || auth.isEmpty()) ? null : auth.get(0);
            String user = sessionService.resolve(token);
            if (user == null) {
                throw new MessagingException("authentication required");
            }
            accessor.setUser(new StompPrincipal(user));
            if (accessor.getSessionAttributes() != null) {
                accessor.getSessionAttributes().put("user", user);
            }
            return message;
        }

        // CONNECT 이후 프레임에서 Principal 복원
        if (accessor.getUser() == null && accessor.getSessionAttributes() != null) {
            String user = (String) accessor.getSessionAttributes().get("user");
            if (user != null) {
                accessor.setUser(new StompPrincipal(user));
            }
        }

        if (accessor.getCommand() == StompCommand.SUBSCRIBE) {
            String destination = accessor.getDestination();
            if (destination == null) {
                throw new MessagingException("subscription not allowed");
            }
            if (LOBBY_TOPIC.matcher(destination).matches()) {
                return message;
            }
            Matcher room = ROOM_TOPIC.matcher(destination);
            if (room.matches()) {
                String roomId = room.group(1);
                String user = requireUser(accessor);
                requirePrivateMember(roomId, user);
                // DEF-03: Presence 리스너가 SessionDisconnectEvent 시 room/user를 복원할 수 있도록 SessionAttributes에 저장
                if (accessor.getSessionAttributes() != null) {
                    accessor.getSessionAttributes().put("roomId", roomId);
                    accessor.getSessionAttributes().put("user", user);
                }
                // T-H4: 방 토픽을 구독 중인 live 세션 수 추적 (세션당 방 1회만 카운트)
                trackRoomSubscription(accessor, roomId, user);
                return message;
            }
            Matcher signal = SIGNAL_TOPIC.matcher(destination);
            if (signal.matches()) {
                String roomId = signal.group(1);
                String targetUid = signal.group(2);
                String user = requireUser(accessor);
                if (!user.equals(targetUid)) {
                    throw new MessagingException("not the signal target");
                }
                requirePrivateMember(roomId, user);
                if (accessor.getSessionAttributes() != null) {
                    accessor.getSessionAttributes().put("roomId", roomId);
                    accessor.getSessionAttributes().put("user", user);
                }
                return message;
            }
            // 화이트리스트 외 모든 구독(와일드카드/미지의 토픽/ /user/**) 거부
            throw new MessagingException("subscription not allowed");
        }
        return message;
    }

    private String requireUser(StompHeaderAccessor accessor) {
        var user = accessor.getUser();
        if (user == null) {
            throw new MessagingException("authentication required");
        }
        return user.getName();
    }

    /** T-H4: (roomId, user) live 세션을 세션 ID로 추적한다 (같은 세션의 중복 구독은 1회만). */
    @SuppressWarnings("unchecked")
    private void trackRoomSubscription(StompHeaderAccessor accessor, String roomId, String user) {
        Map<String, Object> attrs = accessor.getSessionAttributes();
        String sessionId = accessor.getSessionId();
        if (attrs == null || sessionId == null) {
            return;
        }
        Set<String> tracked = (Set<String>) attrs.computeIfAbsent("roomSubscriptions", k -> new HashSet<String>());
        if (tracked.add(roomId)) {
            boolean wasOffline = roomSessionRegistry.count(roomId, user) == 0
                    && roomSessionRegistry.isOffline(roomId, user);
            roomSessionRegistry.add(roomId, user, sessionId);
            roomSessionRegistry.clearOffline(roomId, user);
            // 유예 중(연결 끊김)이던 사용자가 재구독하면 MEMBER_ONLINE 발행 (신규 입장은 발행하지 않음)
            if (wasOffline) {
                Room room = roomMapper.find(roomId);
                if (room != null && roomMapper.members(roomId).contains(user)) {
                    roomEventPublisher.roomEvent(RoomEventPublisher.ROOM_EVENT_ONLINE, room, user, null);
                }
            }
        }
    }

    private void requirePrivateMember(String roomId, String user) {
        var room = roomMapper.find(roomId);
        if (room != null && room.scope().name().equals("PRIVATE")
                && !roomMapper.members(roomId).contains(user)) {
            throw new MessagingException("not a member of private room");
        }
    }
}
