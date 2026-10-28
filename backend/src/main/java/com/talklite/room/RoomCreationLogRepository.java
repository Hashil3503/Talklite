package com.talklite.room;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 방 생성 로그 리포지토리 — 게임 별칭 발굴용 집계 원본.
 * 호스트/사용자 컬럼은 의도적으로 두지 않는다.
 */
@Repository
public class RoomCreationLogRepository {

    private final JdbcClient jdbc;

    public RoomCreationLogRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(Room room) {
        jdbc.sql("""
                INSERT INTO room_creation_log (room_id, game_raw, game_canonical, title, tags, scope, type, created_at)
                VALUES (:roomId, :gameRaw, :gameCanonical, :title, :tags, :scope, :type, :createdAt)
                """)
                .param("roomId", room.id())
                .param("gameRaw", room.game())
                .param("gameCanonical", GameAliases.canonical(room.game()))
                .param("title", room.title())
                .param("tags", joinTags(room.tags()))
                .param("scope", room.scope().name())
                .param("type", room.type().name())
                .param("createdAt", room.createdAt())
                .update();
    }

    private String joinTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return "";
        }
        return String.join(",", tags);
    }
}
