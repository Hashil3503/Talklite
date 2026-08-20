package com.talklite.room;

import jakarta.validation.constraints.NotBlank;

public record JoinRequest(@NotBlank String user) {
}
