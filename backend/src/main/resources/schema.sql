CREATE TABLE IF NOT EXISTS permanent_room (
    id          VARCHAR(36)   NOT NULL PRIMARY KEY,
    game        VARCHAR(128)  NOT NULL,
    tags        VARCHAR(512)   NOT NULL DEFAULT '',
    capacity    INT            NOT NULL,
    scope       VARCHAR(16)    NOT NULL,
    type        VARCHAR(16)    NOT NULL,
    host        VARCHAR(64)    NOT NULL,
    created_at  BIGINT         NOT NULL,
    updated_at  BIGINT         NOT NULL
);

CREATE TABLE IF NOT EXISTS permanent_room_chat (
    id              VARCHAR(64)   NOT NULL PRIMARY KEY,
    room_id         VARCHAR(36)   NOT NULL,
    sender          VARCHAR(64)   NOT NULL,
    sender_nickname VARCHAR(64)   NOT NULL,
    content         VARCHAR(500)  NOT NULL,
    created_at      BIGINT        NOT NULL,
    type            VARCHAR(16)   NOT NULL,
    media_url       VARCHAR(512)  NULL,
    mentions        VARCHAR(2048) NULL,
    INDEX idx_room_created (room_id, created_at)
);
