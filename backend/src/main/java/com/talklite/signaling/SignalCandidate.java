package com.talklite.signaling;

public record SignalCandidate(
        String candidate,
        String sdpMid,
        Integer sdpMLineIndex,
        String usernameFragment
) {
}
