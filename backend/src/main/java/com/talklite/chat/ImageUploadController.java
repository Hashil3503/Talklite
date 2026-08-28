package com.talklite.chat;

import com.talklite.auth.AuthenticatedUser;
import com.talklite.room.RoomMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/rooms")
public class ImageUploadController {

    private static final long MAX_SIZE = 5L * 1024 * 1024;
    private static final Map<String, String> MIME_EXTENSIONS = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/webp", ".webp",
            "image/gif", ".gif"
    );

    private final RoomMapper roomMapper;

    public ImageUploadController(RoomMapper roomMapper) {
        this.roomMapper = roomMapper;
    }

    @PostMapping("/{roomId}/images")
    public ResponseEntity<?> upload(@PathVariable String roomId,
                                    @AuthenticatedUser String principal,
                                    @RequestParam("file") MultipartFile file) {
        if (roomMapper.find(roomId) == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "room_not_found"));
        }
        // 멤버십 검증 강화: 비멤버는 업로드 불가 (404/403 중 403 선택)
        // 빈 방 또는 미가입자 방지 — membersKey 검사
        var members = roomMapper.members(roomId);
        if (!members.contains(principal)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "not_a_member"));
        }
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "empty_file"));
        }
        if (file.getSize() > MAX_SIZE) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error", "file_too_large"));
        }
        String contentType = file.getContentType();
        String normalizedContentType = contentType == null ? "" : contentType.trim().toLowerCase(Locale.ROOT);
        String ext = MIME_EXTENSIONS.get(normalizedContentType);
        if (ext == null || !hasMatchingExtension(file.getOriginalFilename(), ext)) {
            return ResponseEntity.badRequest().body(Map.of("error", "unsupported_type"));
        }

        String filename = UUID.randomUUID() + ext;
        Path dir = Path.of("uploads", "images").toAbsolutePath().normalize();
        try {
            Files.createDirectories(dir);
            Path target = dir.resolve(filename).normalize();
            if (!target.startsWith(dir)) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_path"));
            }
            file.transferTo(target.toFile());
            String url = "/api/images/" + filename;
            return ResponseEntity.ok(Map.of("url", url, "mediaUrl", url));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "io_error"));
        }
    }

    private boolean hasMatchingExtension(String originalFilename, String expectedExtension) {
        if (originalFilename == null || originalFilename.isBlank()) {
            return true;
        }
        String normalized = originalFilename.replace('\\', '/');
        int separator = normalized.lastIndexOf('/');
        String basename = separator >= 0 ? normalized.substring(separator + 1) : normalized;
        return basename.toLowerCase(Locale.ROOT).endsWith(expectedExtension);
    }
}
