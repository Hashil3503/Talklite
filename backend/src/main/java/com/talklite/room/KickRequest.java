package com.talklite.room;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record KickRequest(
        @NotBlank String actor,
        @NotBlank String targetUser,
        @NotNull KickType type
) {
}
