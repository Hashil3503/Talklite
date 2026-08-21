package com.talklite.room;

public class InviteRequiredException extends RuntimeException {

    public InviteRequiredException() {
        super("this room is private and requires an invite code");
    }
}
