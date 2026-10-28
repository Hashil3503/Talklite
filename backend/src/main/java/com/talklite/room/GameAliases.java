package com.talklite.room;

import java.util.Map;

/** 게임명 별칭 정규화 유틸 — 공백/대소문자 무시 + 대표 한글명 매핑 */
public final class GameAliases {

    // 신규 별칭은 room_creation_log 의 game_raw/game_canonical 집계로 발굴해 추가
    private static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("lol", "리그오브레전드"),
            Map.entry("leagueoflegends", "리그오브레전드"),
            Map.entry("롤", "리그오브레전드"),
            Map.entry("valorant", "발로란트"),
            Map.entry("pubg", "배틀그라운드"),
            Map.entry("battlegrounds", "배틀그라운드"),
            Map.entry("배그", "배틀그라운드"),
            Map.entry("overwatch2", "오버워치2"),
            Map.entry("overwatch", "오버워치2"),
            Map.entry("ow2", "오버워치2"),
            Map.entry("옵치", "오버워치2")
    );

    private GameAliases() {
    }

    public static String normalize(String raw) {
        return raw == null ? "" : raw.toLowerCase().replaceAll("\\s+", "");
    }

    public static String canonical(String raw) {
        String n = normalize(raw);
        return ALIASES.getOrDefault(n, n);
    }
}
