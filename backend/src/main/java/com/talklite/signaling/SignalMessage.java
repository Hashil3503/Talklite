package com.talklite.signaling;

/**
 * WebRTC 시그널링 메시지 (FR-VOICE-02).
 * 발신자(from)는 클라이언트 페이로드가 아닌 Principal(인증 세션) 기반으로 서버가 덮어쓴다.
 */
public record SignalMessage(
        String from,
        String to,
        SignalType type,
        String sdp,
        SignalCandidate candidate
) {
}
