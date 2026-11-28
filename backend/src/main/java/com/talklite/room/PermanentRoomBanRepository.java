package com.talklite.room;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 영구 방(PERMANENT) 영구 강퇴(KickType.PERMANENT) MariaDB 영속화 리포지토리.
 * Redis Set(room:{id}:banned)은 재기동 시 유실되므로 RoomRehydrator가 본 테이블에서 복원한다.
 */
@Repository
public class PermanentRoomBanRepository {

    private final JdbcClient jdbc;

    public PermanentRoomBanRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** 영구 강퇴 1건 영속화 (멱등) */
    public void save(String roomId, String userId) {
        jdbc.sql("""
                INSERT INTO permanent_room_ban (room_id, user_id, created_at)
                VALUES (:roomId, :userId, :createdAt)
                ON DUPLICATE KEY UPDATE created_at = created_at
                """)
                .param("roomId", roomId)
                .param("userId", userId)
                .param("createdAt", System.currentTimeMillis())
                .update();
    }

    /** 방의 영구 강퇴 사용자 목록 */
    public List<String> findByRoomId(String roomId) {
        return jdbc.sql("SELECT user_id FROM permanent_room_ban WHERE room_id = :roomId ORDER BY created_at")
                .param("roomId", roomId)
                .query(String.class)
                .list();
    }

    /** 방 파기 시 해당 방 강퇴 목록 전체 삭제 */
    public void deleteByRoomId(String roomId) {
        jdbc.sql("DELETE FROM permanent_room_ban WHERE room_id = :roomId")
                .param("roomId", roomId)
                .update();
    }
}
