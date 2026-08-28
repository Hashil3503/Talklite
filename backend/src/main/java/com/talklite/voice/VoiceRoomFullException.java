package com.talklite.voice;

public class VoiceRoomFullException extends RuntimeException {

    public VoiceRoomFullException() {
        super("voice room is full");
    }
}
