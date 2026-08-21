package com.talklite.room;

public class InvalidKickException extends RuntimeException {

    public InvalidKickException() {
        super("invalid kick request");
    }
}
