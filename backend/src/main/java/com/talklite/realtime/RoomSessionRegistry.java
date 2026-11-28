package com.talklite.realtime;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * T-H4: (roomId, user) 별로 해당 방 토픽을 구독 중인 live STOMP 세션을 메모리에 추적한다.
 * 단일 서버 기준의 가장 단순한 구현(Redis 왕복/직렬화 불필요)이며,
 * 서버 재기동 시 추적 정보는 초기화되지만 그 경우 세션 자체도 모두 끊긴 상태다.
 *
 * 세션 ID 집합으로 관리하므로, 재접속한 세션의 SUBSCRIBE와 끊긴 세션의 DISCONNECT가
 * 어떤 순서로 도착해도 "현재 살아 있는 세션 수"를 정확히 계산할 수 있다.
 */
@Component
public class RoomSessionRegistry {

    private final Map<String, Set<String>> sessionsByRoomAndUser = new ConcurrentHashMap<>();

    private String key(String roomId, String user) {
        return roomId + "\u0000" + user;
    }

    /** 방 토픽 SUBSCRIBE 시 호출 (같은 세션의 중복 호출은 무시) */
    public void add(String roomId, String user, String sessionId) {
        sessionsByRoomAndUser
                .computeIfAbsent(key(roomId, user), k -> ConcurrentHashMap.newKeySet())
                .add(sessionId);
    }

    /** 연결 종료(Disconnect) 시 호출 */
    public void remove(String roomId, String user, String sessionId) {
        sessionsByRoomAndUser.computeIfPresent(key(roomId, user), (k, ids) -> {
            ids.remove(sessionId);
            return ids.isEmpty() ? null : ids;
        });
    }

    /** 해당 방을 구독 중인 live 세션 수 */
    public int count(String roomId, String user) {
        Set<String> ids = sessionsByRoomAndUser.get(key(roomId, user));
        return ids == null ? 0 : ids.size();
    }
}
