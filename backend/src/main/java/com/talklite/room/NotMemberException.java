package com.talklite.room;

/** 비공개 방의 비멤버 접근 (403 not_a_member) */
public class NotMemberException extends RuntimeException {

    public NotMemberException() {
        super("not a member of private room");
    }
}
