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
