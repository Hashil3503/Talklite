package com.talklite.voice;

/**
 * 발화자 상태 이벤트 (FR-VOICE-03, T-05) — 방 전체 브로드캐스트.
 */
public record SpeakerEvent(
        String roomId,
        String speakerId,
        boolean talking
) {
}
