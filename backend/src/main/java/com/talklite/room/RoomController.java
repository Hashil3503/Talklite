package com.talklite.room;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {

    private final RoomService roomService;
    private final KickService kickService;

    public RoomController(RoomService roomService, KickService kickService) {
        this.roomService = roomService;
        this.kickService = kickService;
    }

    @PostMapping
    public RoomResponse create(@Valid @RequestBody CreateRoomRequest request) {
        return roomService.create(request);
    }

    @GetMapping("/{roomId}")
    public RoomResponse get(@PathVariable String roomId) {
        return roomService.get(roomId);
    }

    @PostMapping("/{roomId}/members/{user}")
    public RoomResponse join(@PathVariable String roomId, @PathVariable String user) {
        return roomService.join(roomId, user);
    }

    @DeleteMapping("/{roomId}/members/{user}")
    public RoomResponse leave(@PathVariable String roomId, @PathVariable String user) {
        return roomService.leave(roomId, user);
    }

    @PostMapping("/{roomId}/join")
    public RoomResponse joinAlias(@PathVariable String roomId, @Valid @RequestBody JoinRequest body) {
        return roomService.join(roomId, body.user());
    }

    @PostMapping("/{roomId}/leave")
    public RoomResponse leaveAlias(@PathVariable String roomId, @Valid @RequestBody JoinRequest body) {
        return roomService.leave(roomId, body.user());
    }

    @PostMapping("/{roomId}/kick")
    public RoomResponse kick(@PathVariable String roomId, @Valid @RequestBody KickRequest body) {
        return kickService.kick(roomId, body);
    }
}
