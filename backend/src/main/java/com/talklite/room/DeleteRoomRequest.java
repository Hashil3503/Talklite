package com.talklite.room;

import jakarta.validation.constraints.NotBlank;

public record DeleteRoomRequest(
        @NotBlank String actor
) {
}