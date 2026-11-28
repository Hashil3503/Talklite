package com.talklite.chat;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Stream;

/**
 * T-M14: 방별 이미지 저장 디렉터리 관리 단일 지점.
 * 저장 위치는 uploads/images/{roomId}/ 이며, 방 파기 시 해당 디렉터리를 재귀 삭제한다.
 * 삭제 실패는 로그만 남기고 호출 흐름(방 삭제)을 막지 않는다.
 */
@Component
public class RoomImageStorage {

    private static final Logger log = LoggerFactory.getLogger(RoomImageStorage.class);

    private final Path root = Path.of("uploads", "images").toAbsolutePath().normalize();

    /** roomId가 단일 경로 세그먼트로 안전한지 검증 (경로 탈출 차단) */
    public static boolean isSafeRoomId(String roomId) {
        return roomId != null && roomId.matches("[A-Za-z0-9_-]{1,36}");
    }

    /** 방 전용 이미지 디렉터리 (없으면 생성하지 않는다) */
    public Path roomDirectory(String roomId) {
        return root.resolve(roomId).normalize();
    }

    /** 업로드 저장 디렉터리 생성 후 반환 */
    public Path ensureRoomDirectory(String roomId) throws IOException {
        Path dir = roomDirectory(roomId);
        Files.createDirectories(dir);
        return dir;
    }

    /** 방 파기 시 uploads/images/{roomId}/ 재귀 삭제 (실패는 로그만) */
    public void deleteRoomImages(String roomId) {
        if (!isSafeRoomId(roomId)) {
            log.warn("skip image cleanup for unsafe roomId={}", roomId);
            return;
        }
        Path dir = roomDirectory(roomId);
        if (!dir.startsWith(root) || !Files.exists(dir)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(dir)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException e) {
                    log.warn("failed to delete uploaded image file: {}", path, e);
                }
            });
        } catch (IOException e) {
            log.warn("failed to delete uploaded images for room={}", roomId, e);
        }
    }
}
