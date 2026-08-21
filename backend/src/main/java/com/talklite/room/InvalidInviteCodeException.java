package com.talklite.room;

public class InvalidInviteCodeException extends RuntimeException {

    public InvalidInviteCodeException() {
        super("invalid invite code");
    }
}
