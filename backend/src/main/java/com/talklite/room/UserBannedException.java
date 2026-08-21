package com.talklite.room;

public class UserBannedException extends RuntimeException {

    public UserBannedException() {
        super("user is banned from this room");
    }
}
