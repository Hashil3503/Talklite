package com.talklite.room;

public class RoomCapacityConflictException extends RuntimeException {
    public RoomCapacityConflictException(String message) {
        super(message);
    }
    public RoomCapacityConflictException() {
        super("room_capacity_conflict");
    }
}
