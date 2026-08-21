package com.talklite.config;

import com.talklite.auth.SessionService;
import com.talklite.room.RoomMapper;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * STOMP 사전 인증/인가 (NFR-SEC-01, NFR-SEC-02).
 * - CONNECT: Authorization: Bearer <token> → SessionService 검증 → StompPrincipal 등록 (미인증 시 연결 거부)
 * - SUBSCRIBE: 비공개 방(/topic/room/{id}* ) 구독 시 방 멤버십 인가 검증
 */
@Component
public class WebSocketAuthInterceptor implements ChannelInterceptor {

    private final SessionService sessionService;
    private final RoomMapper roomMapper;

    public WebSocketAuthInterceptor(SessionService sessionService, RoomMapper roomMapper) {
        this.sessionService = sessionService;
        this.roomMapper = roomMapper;
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
                throw new org.springframework.messaging.MessagingException("authentication required");
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
            String roomId = roomIdFromTopic(destination);
            if (destination != null && destination.startsWith("/topic/room/") && roomId != null) {
                var user = accessor.getUser();
                if (user == null) {
                    throw new org.springframework.messaging.MessagingException("authentication required");
                }
                var room = roomMapper.find(roomId);
                if (room != null && room.scope().name().equals("PRIVATE")
                        && !roomMapper.members(roomId).contains(user.getName())) {
                    throw new org.springframework.messaging.MessagingException("not a member of private room");
                }
            }
        }
        return message;
    }

    private String roomIdFromTopic(String destination) {
        if (destination == null || !destination.startsWith("/topic/room/")) {
            return null;
        }
        String rest = destination.substring("/topic/room/".length());
        int slash = rest.indexOf('/');
        return slash >= 0 ? rest.substring(0, slash) : rest;
    }
}
