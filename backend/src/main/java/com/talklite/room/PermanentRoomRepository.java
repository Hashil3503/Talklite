package com.talklite.room;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 영구 방(PERMANENT) MariaDB 영속화 리포지토리 (FR-ROOM-03, T-06).
 * JdbcClient 기반 upsert/방장 갱신/전체 조회/삭제. 영구 방은 소멸되지 않으므로 delete는 T-06 격리·정리용.
 */
@Repository
public class PermanentRoomRepository {

    private static final String COLUMNS = "id, title, game, tags, capacity, scope, type, host, created_at, updated_at";

    private final JdbcClient jdbc;

    public PermanentRoomRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** 생성/갱신 upsert (온 DUPLICATE KEY, 방장 승계 시 host 갱신 포함) */
    public void upsert(Room room) {
        upsert(room, System.currentTimeMillis());
    }

    public void upsert(Room room, long updatedAt) {
        jdbc.sql("""
                INSERT INTO permanent_room (id, title, game, tags, capacity, scope, type, host, created_at, updated_at)
                VALUES (:id, :title, :game, :tags, :capacity, :scope, :type, :host, :createdAt, :updatedAt)
                ON DUPLICATE KEY UPDATE
                    title = VALUES(title),
                    game = VALUES(game),
                    tags = VALUES(tags),
                    capacity = VALUES(capacity),
                    scope = VALUES(scope),
                    type = VALUES(type),
                    host = VALUES(host),
                    updated_at = VALUES(updated_at)
                """)
                .param("id", room.id())
                .param("title", room.title())
                .param("game", room.game())
                .param("tags", joinTags(room.tags()))
                .param("capacity", room.capacity())
                .param("scope", room.scope().name())
                .param("type", room.type().name())
                .param("host", room.host())
                .param("createdAt", room.createdAt())
                .param("updatedAt", updatedAt)
                .update();
    }

    /** HostMigration(방장 승계) 시 DB host 동기화 (T-06) */
    public void updateHost(String roomId, String newHost, long updatedAt) {
        jdbc.sql("UPDATE permanent_room SET host = :host, updated_at = :updatedAt WHERE id = :id")
                .param("host", newHost)
                .param("updatedAt", updatedAt)
                .param("id", roomId)
                .update();
    }

    public Optional<Room> findById(String roomId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM permanent_room WHERE id = :id")
                .param("id", roomId)
                .query((rs, rowNum) -> new Room(
                        rs.getString("id"),
                        rs.getString("title"),
                        rs.getString("game"),
                        splitTags(rs.getString("tags")),
                        rs.getInt("capacity"),
                        RoomScope.valueOf(rs.getString("scope")),
                        RoomType.valueOf(rs.getString("type")),
                        rs.getString("host"),
                        rs.getLong("created_at")
                ))
                .optional();
    }

    public List<Room> findAll() {
        return jdbc.sql("SELECT " + COLUMNS + " FROM permanent_room")
                .query((rs, rowNum) -> new Room(
                        rs.getString("id"),
                        rs.getString("title"),
                        rs.getString("game"),
                        splitTags(rs.getString("tags")),
                        rs.getInt("capacity"),
                        RoomScope.valueOf(rs.getString("scope")),
                        RoomType.valueOf(rs.getString("type")),
                        rs.getString("host"),
                        rs.getLong("created_at")
                ))
                .list();
    }

    public void delete(String roomId) {
        jdbc.sql("DELETE FROM permanent_room WHERE id = :id").param("id", roomId).update();
    }

    /** Phase 11: 방 정보 수정 시 영구방 동기화 (title/game/tags/capacity) */
    public void updateRoom(String roomId, String title, String game, List<String> tags, int capacity, long updatedAt) {
        // title은 nullable — null이면 기존 값 유지 (COALESCE), game/tags/capacity는 필수 갱신
        jdbc.sql("""
                UPDATE permanent_room
                SET title = COALESCE(:title, title),
                    game = :game,
                    tags = :tags,
                    capacity = :capacity,
                    updated_at = :updatedAt
                WHERE id = :id
                """)
                .param("title", title)
                .param("game", game)
                .param("tags", joinTags(tags))
                .param("capacity", capacity)
                .param("updatedAt", updatedAt)
                .param("id", roomId)
                .update();
    }

    private String joinTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return "";
        }
        return String.join(",", tags);
    }

    private List<String> splitTags(String csv) {
        if (csv == null || csv.isBlank()) {
            return new ArrayList<>();
        }
        return List.of(csv.split(","));
    }
}
