package com.talklite.room;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateRoomRequest(
        @NotBlank String game,
        @Size(max = 5) List<@NotBlank String> tags,
        @Min(2) @Max(10) int capacity,
        @NotNull RoomScope scope,
        @NotNull RoomType type,
        @NotBlank String host
) {
}
