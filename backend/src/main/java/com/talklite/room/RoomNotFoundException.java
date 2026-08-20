package com.talklite.room;

public class RoomNotFoundException extends RuntimeException {

    private final String roomId;

    public RoomNotFoundException(String roomId) {
        super("room not found: " + roomId);
        this.roomId = roomId;
    }

    public String getRoomId() {
        return roomId;
    }
}
