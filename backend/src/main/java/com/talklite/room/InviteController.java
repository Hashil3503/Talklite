package com.talklite.room;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class InviteController {

    private final InviteService inviteService;

    public InviteController(InviteService inviteService) {
        this.inviteService = inviteService;
    }

    @PostMapping("/api/rooms/{roomId}/invite")
    public InviteResponse create(@PathVariable String roomId, @RequestBody InviteRequest body) {
        return inviteService.create(roomId, body.actor());
    }

    @GetMapping("/api/rooms/{roomId}/invite")
    public Map<String, String> get(@PathVariable String roomId, @RequestParam String actor) {
        return Map.of("code", inviteService.getOrCreate(roomId, actor));
    }

    @PostMapping("/api/invite/{code}/join")
    public RoomResponse join(@PathVariable String code, @RequestBody JoinRequest body) {
        return inviteService.joinByCode(code, body.user());
    }
}
