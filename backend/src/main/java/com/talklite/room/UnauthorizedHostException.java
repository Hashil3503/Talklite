package com.talklite.room;

public class UnauthorizedHostException extends RuntimeException {

    public UnauthorizedHostException() {
        super("only the room host can perform this action");
    }
}
