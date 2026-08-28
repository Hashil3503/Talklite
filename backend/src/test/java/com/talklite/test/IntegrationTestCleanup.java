package com.talklite.test;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

public abstract class IntegrationTestCleanup {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    protected com.talklite.auth.SessionService sessionService;

    protected String tokenFor(String user) {
        return "Bearer " + sessionService.create(user).token();
    }

    @BeforeEach
    void cleanBeforeEach() {
        clean();
    }

    @AfterEach
    void cleanAfterEach() {
        clean();
    }

    private void clean() {
        jdbc.sql("DELETE FROM permanent_room").update();
        jdbc.sql("DELETE FROM permanent_room_chat").update();
        var connection = redis.getConnectionFactory().getConnection();
        try {
            connection.serverCommands().flushDb();
        } finally {
            connection.close();
        }
    }
}
