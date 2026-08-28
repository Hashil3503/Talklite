package com.talklite.room;

import com.talklite.auth.AuthenticatedUser;
import com.talklite.chat.ChatMessage;
import com.talklite.chat.ChatService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {

    private final RoomService roomService;
    private final KickService kickService;
    private final ChatService chatService;

    public RoomController(RoomService roomService, KickService kickService, ChatService chatService) {
        this.roomService = roomService;
        this.kickService = kickService;
        this.chatService = chatService;
    }

    @PostMapping
    public RoomResponse create(@AuthenticatedUser String principal,
                               @Valid @RequestBody CreateRoomRequest request) {
        return roomService.create(request, principal);
    }

    @GetMapping("/{roomId}")
    public RoomResponse get(@PathVariable String roomId) {
        return roomService.get(roomId);
    }

    /**
     * 최근 대화 내역 조회 (영구방 입장/새로고침 시 복원용).
     * Redis 캐시 우선 → 미존재 시 MariaDB 폴백, 과거순(오래된 순) 반환.
     */
    @GetMapping("/{roomId}/messages")
    public List<ChatMessage> getMessages(@PathVariable String roomId,
                                         @RequestParam(name = "limit", defaultValue = "50") int limit) {
        return chatService.recentMessages(roomId, limit);
    }

    @PostMapping("/{roomId}/members/{user}")
    public RoomResponse join(@PathVariable String roomId,
                             @PathVariable String user,
                             @AuthenticatedUser String principal) {
        if (!principal.equals(user)) {
            throw new UnauthorizedHostException();
        }
        return roomService.join(roomId, principal);
    }

    @DeleteMapping("/{roomId}/members/{user}")
    public RoomResponse leave(@PathVariable String roomId,
                              @PathVariable String user,
                              @AuthenticatedUser String principal) {
        if (!principal.equals(user)) {
            throw new UnauthorizedHostException();
        }
        return roomService.leave(roomId, principal);
    }

    @PostMapping("/{roomId}/join")
    public RoomResponse joinAlias(@PathVariable String roomId,
                                  @AuthenticatedUser String principal,
                                  @Valid @RequestBody JoinRequest body) {
        if (!principal.equals(body.user())) {
            throw new UnauthorizedHostException();
        }
        return roomService.join(roomId, principal);
    }

    @PostMapping("/{roomId}/leave")
    public RoomResponse leaveAlias(@PathVariable String roomId,
                                   @AuthenticatedUser String principal,
                                   @Valid @RequestBody JoinRequest body) {
        if (!principal.equals(body.user())) {
            throw new UnauthorizedHostException();
        }
        return roomService.leave(roomId, principal);
    }

    @PostMapping("/{roomId}/kick")
    public RoomResponse kick(
            @PathVariable String roomId,
            @AuthenticatedUser String principal,
            @Valid @RequestBody KickRequest body) {
        if (!principal.equals(body.actor())) {
            throw new UnauthorizedHostException();
        }
        return kickService.kick(roomId, body, principal);
    }

    @DeleteMapping("/{roomId}")
    public org.springframework.http.ResponseEntity<Void> deleteRoom(
            @PathVariable String roomId,
            @AuthenticatedUser String principal,
            @Valid @RequestBody DeleteRoomRequest body) {
        if (!principal.equals(body.actor())) {
            throw new UnauthorizedHostException();
        }
        roomService.deleteByHost(roomId, principal);
        return org.springframework.http.ResponseEntity.noContent().build();
    }

    @PatchMapping("/{roomId}")
    public RoomResponse updateRoom(
            @PathVariable String roomId,
            @AuthenticatedUser String principal,
            @Valid @RequestBody UpdateRoomRequest body) {
        return roomService.updateRoom(roomId, principal, body);
    }
}
