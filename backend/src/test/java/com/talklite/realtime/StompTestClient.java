package com.talklite.realtime;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;

import java.net.URI;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * STOMP raw(plain-text) client for integration tests.
 */
public class StompTestClient {

    private final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
    private final WebSocketSession session;

    public StompTestClient(int port, String token) throws Exception {
        TextWebSocketHandler handler = new TextWebSocketHandler() {
            @Override
            public void handleTextMessage(WebSocketSession s, TextMessage m) throws Exception {
                frames.add(m.getPayload());
            }
        };
        session = new StandardWebSocketClient().execute(
                handler,
                new WebSocketHttpHeaders(),
                new URI("ws://localhost:" + port + "/ws")
        ).get(5, TimeUnit.SECONDS);
        session.sendMessage(new TextMessage(
                "CONNECT\naccept-version:1.2\nAuthorization:Bearer " + token + "\nheart-beat:0,0\n\n\u0000"));
        // CONNECTED 수신 대기
        frames.poll(5, TimeUnit.SECONDS);
    }

    public void subscribe(String destination) throws Exception {
        session.sendMessage(new TextMessage("SUBSCRIBE\nid:sub-" + System.nanoTime() + "\ndestination:" + destination + "\n\n\u0000"));
        Thread.sleep(100);
    }

    public void send(String destination, String jsonBody) throws Exception {
        session.sendMessage(new TextMessage("SEND\ndestination:" + destination + "\ncontent-type:application/json\n\n" + jsonBody + "\u0000"));
    }

    public String await(long seconds) throws Exception {
        return frames.poll(seconds, TimeUnit.SECONDS);
    }

    public String tryPoll(long millis) throws Exception {
        return frames.poll(millis, TimeUnit.MILLISECONDS);
    }

    public void close() {
        try {
            session.close();
        } catch (Exception ignored) {
        }
    }
}
