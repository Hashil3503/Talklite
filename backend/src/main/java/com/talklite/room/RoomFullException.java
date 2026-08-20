package com.talklite.room;

public class RoomFullException extends RuntimeException {

    public RoomFullException() {
        super("room is full");
    }
}
