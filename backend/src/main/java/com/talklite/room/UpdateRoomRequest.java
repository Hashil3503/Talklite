package com.talklite.room;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateRoomRequest(
        // title optional — 방 제목 (별도 title 필드, 없으면 기존 유지)
        @Size(max = 50) String title,
        @Size(max = 128) String game,
        // raw tags size unchecked here — dedup/normalize in service enforces max 5 unique
        List<@Size(max = 30) String> tags,
        @Min(2) @Max(value = 6, message = "최대 정원은 6명입니다.") Integer capacity
) {
}
