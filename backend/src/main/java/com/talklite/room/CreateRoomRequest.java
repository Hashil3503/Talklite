package com.talklite.room;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateRoomRequest(
        @Size(max = 50) String title,
        @NotBlank String game,
        @Size(max = 5) List<@NotBlank String> tags,
        @Min(2) @Max(value = 6, message = "최대 정원은 6명입니다.") int capacity,
        @NotNull RoomScope scope,
        @NotNull RoomType type,
        @NotBlank String host
) {
    /** 6-arg 하위 호환 생성자 — title 미지정 시 null (P0-03 원자 계약) */
    public CreateRoomRequest(String game, List<String> tags, int capacity, RoomScope scope, RoomType type, String host) {
        this(null, game, tags, capacity, scope, type, host);
    }
}
