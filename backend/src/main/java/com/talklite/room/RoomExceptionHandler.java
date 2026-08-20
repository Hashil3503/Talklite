package com.talklite.room;

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

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> invalid(MethodArgumentNotValidException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
    }
}
