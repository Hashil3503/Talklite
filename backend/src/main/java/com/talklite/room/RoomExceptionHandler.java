package com.talklite.room;

import com.talklite.auth.UnauthorizedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class RoomExceptionHandler {

    @ExceptionHandler(RoomNotFoundException.class)
    ResponseEntity<Map<String, String>> notFound(RoomNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", "room_not_found", "roomId", e.getRoomId()));
    }

    @ExceptionHandler(RoomFullException.class)
    ResponseEntity<Map<String, String>> notFull(RoomFullException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", "room_full"));
    }

    @ExceptionHandler(UserBannedException.class)
    ResponseEntity<Map<String, String>> banned(UserBannedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "user_banned"));
    }

    @ExceptionHandler(UnauthorizedHostException.class)
    ResponseEntity<Map<String, String>> unauthorized(UnauthorizedHostException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "unauthorized_host"));
    }

    @ExceptionHandler(InvalidKickException.class)
    public ResponseEntity<Map<String, String>> invalidKick(InvalidKickException e) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", "invalid_kick"));
    }

    @ExceptionHandler(InviteRequiredException.class)
    public ResponseEntity<Map<String, String>> inviteRequired(InviteRequiredException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "invite_required"));
    }

    @ExceptionHandler(InvalidInviteCodeException.class)
    public ResponseEntity<Map<String, String>> invalidInvite(InvalidInviteCodeException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", "invite_invalid"));
    }

    @ExceptionHandler(UnauthorizedException.class)
    ResponseEntity<Map<String, String>> authRequired(UnauthorizedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "unauthorized"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> invalid(MethodArgumentNotValidException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
    }
}
