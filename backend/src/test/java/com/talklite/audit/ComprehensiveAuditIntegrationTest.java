package com.talklite.audit;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.StompTestClient;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.JoinRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import com.talklite.test.IntegrationTestCleanup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class ComprehensiveAuditIntegrationTest extends IntegrationTestCleanup {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private StringRedisTemplate redis;
    @Autowired private JdbcClient jdbc;
    @LocalServerPort private int port;

    private String createRoom(String host, String game, List<String> tags, int capacity, RoomType type) throws Exception {
        CreateRoomRequest req = new CreateRoomRequest(game, tags, capacity, RoomScope.PUBLIC, type, host);
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(content).get("id").asText();
    }

    private RoomResponse getRoom(String roomId) throws Exception {
        String content = mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class);
    }

    private List<RoomResponse> searchByTag(String tag) throws Exception {
        // use host token for search
        String content = mockMvc.perform(get("/api/search").param("tags", tag)
                        .header("Authorization", tokenFor("searcher")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<>() {});
    }

    private SessionResponse createSession(String user) throws Exception {
        String json = mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new SessionRequest(user))))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, SessionResponse.class);
    }

    private String extractMentionsFromChatFrame(String frame) throws Exception {
        // frames are STOMP frames containing JSON; extract JSON body after blank line
        if (frame == null) return null;
        int idx = frame.indexOf("\n\n");
        String body = idx >= 0 ? frame.substring(idx + 2) : frame;
        // strip trailing \u0000
        body = body.replace("\u0000", "").trim();
        // try to parse as JsonNode, return mentions array as string
        try {
            JsonNode node = objectMapper.readTree(body);
            if (node.has("mentions")) return node.get("mentions").toString();
            return body;
        } catch (Exception e) {
            return body;
        }
    }

    // 1. 인증 및 권한 경계 검증
    @Test
    @DisplayName("Audit-1: 비인증 PATCH 401")
    void unauthenticatedPatchReturns401() throws Exception {
        String host = "audit-host-1";
        String roomId = createRoom(host, "Audit Game", List.of("audit"), 4, RoomType.TEMPORARY);
        Map<String, Object> patch = Map.of("game", "Hacked");

        // no auth header
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isUnauthorized());

        // expired/invalid token
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", "Bearer invalid-token-xyz")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isUnauthorized());

        // expired via Redis deletion
        SessionResponse sess = createSession("audit-expire-user");
        // need a room owned by that user to test expired ownership? Just test patch with expired token on existing room
        // delete session key
        redis.delete("session:" + sess.token());
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", "Bearer " + sess.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Audit-2: 비방장 PATCH 403")
    void nonHostPatchReturns403() throws Exception {
        String host = "audit-host-2";
        String guest = "audit-guest-2";
        String roomId = createRoom(host, "Audit Game2", List.of("audit"), 4, RoomType.TEMPORARY);
        // guest join
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor(guest))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(guest))))
                .andExpect(status().isOk());

        Map<String, Object> patch = Map.of("game", "Hacked2");
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(guest))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Audit-3: 비참여자 이미지 업로드 403")
    void nonMemberImageUploadReturns403() throws Exception {
        String host = "audit-host-3";
        String outsider = "audit-outsider-3";
        String roomId = createRoom(host, "Audit Game3", List.of("img"), 4, RoomType.TEMPORARY);

        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", new byte[]{(byte)0x89, 0x50, 0x4E, 0x47});
        mockMvc.perform(multipart("/api/rooms/" + roomId + "/images")
                        .file(file)
                        .header("Authorization", tokenFor(outsider)))
                .andExpect(status().isForbidden());

        // also test unauthenticated image upload 401
        MockMultipartFile file2 = new MockMultipartFile("file", "test2.png", "image/png", new byte[]{(byte)0x89, 0x50, 0x4E, 0x47});
        mockMvc.perform(multipart("/api/rooms/" + roomId + "/images")
                        .file(file2))
                .andExpect(status().isUnauthorized());
    }

    // 2. PATCH 및 Lua 정원/경계값
    @Test
    @DisplayName("Audit-4: null/빈 태그 NPE 없이 저장")
    void patchWithNullOrEmptyTagsNoNPE() throws Exception {
        String host = "audit-host-4";
        String roomId = createRoom(host, "Audit Game4", List.of("keep"), 4, RoomType.TEMPORARY);

        // tags: []  (empty)
        Map<String, Object> patchEmpty = Map.of("tags", List.of());
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patchEmpty)))
                .andExpect(status().isOk());
        RoomResponse afterEmpty = getRoom(roomId);
        assertTrue(afterEmpty.tags().isEmpty(), "empty tags should be saved as empty");

        // tags omitted (null) -> should keep existing or not NPE (we send only capacity)
        Map<String, Object> patchNoTags = Map.of("capacity", 5);
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patchNoTags)))
                .andExpect(status().isOk());
        // still empty tags (since previous was empty, keeping should stay empty)
        RoomResponse afterKeep = getRoom(roomId);
        assertNotNull(afterKeep.tags());

        // null via raw JSON {"tags":null}
        String rawNull = "{\"tags\":null}";
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(rawNull))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Audit-5: 태그 소문자/공백/중복 정규화")
    void tagNormalizationLowerTrimDedup() throws Exception {
        String host = "audit-host-5";
        String roomId = createRoom(host, "Audit Game5", List.of("init"), 4, RoomType.TEMPORARY);

        // send tags with spaces, uppercase, duplicates
        Map<String, Object> patch = Map.of("tags", List.of("  Foo  ", "foo", "BAR ", "bar", "  BAZ", "  foo"));
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tags").isArray());

        RoomResponse after = getRoom(roomId);
        // should be lowercased, trimmed, deduped => foo, bar, baz  (3 unique)
        Set<String> expected = Set.of("foo", "bar", "baz");
        assertEquals(expected, Set.copyOf(after.tags()));
        for (String t : after.tags()) {
            assertEquals(t.toLowerCase(), t, "tag should be lowercase");
            assertEquals(t.trim(), t, "tag should be trimmed");
        }
    }

    @Test
    @DisplayName("Audit-6: 정원 축소 409 및 확장 후 신규 수용")
    void capacityConflictAndExpansion() throws Exception {
        String host = "audit-host-6";
        String roomId = createRoom(host, "Audit Game6", List.of("cap"), 4, RoomType.TEMPORARY);
        // join 2 more => total 3
        for (String g : List.of("guest-a6", "guest-b6")) {
            mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                            .header("Authorization", tokenFor(g))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new JoinRequest(g))))
                    .andExpect(status().isOk());
        }
        RoomResponse before = getRoom(roomId);
        assertEquals(3, before.count());

        // try reduce to 2 => 409
        Map<String, Object> patchConflict = Map.of("capacity", 2);
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patchConflict)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("room_capacity_conflict"));

        // expand to 5 => success
        Map<String, Object> patchExpand = Map.of("capacity", 5);
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patchExpand)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capacity").value(5));

        // new member should be able to join
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor("guest-c6"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("guest-c6"))))
                .andExpect(status().isOk());

        RoomResponse after = getRoom(roomId);
        assertEquals(4, after.count());
        assertEquals(5, after.capacity());
    }

    // 3. 태그/게임 원자 재색인 및 검색 정합성
    @Test
    @DisplayName("Audit-7: 태그 원자 재색인 검색 정합성")
    void tagAtomicReindexSearch() throws Exception {
        String host = "audit-host-7";
        String roomId = createRoom(host, "TagGame", List.of("oldtag-xyz", "fps"), 4, RoomType.TEMPORARY);

        // oldtag searchable
        String searchOldBefore = mockMvc.perform(get("/api/search").param("tags", "oldtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<RoomResponse> before = objectMapper.readValue(searchOldBefore, new TypeReference<>() {});
        assertTrue(before.stream().anyMatch(r -> r.id().equals(roomId)), "oldtag should be searchable before patch");

        // patch to newtag
        Map<String, Object> patch = Map.of("tags", List.of("newtag-xyz", "fps"));
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isOk());

        // newtag searchable
        String searchNew = mockMvc.perform(get("/api/search").param("tags", "newtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<RoomResponse> afterNew = objectMapper.readValue(searchNew, new TypeReference<>() {});
        assertTrue(afterNew.stream().anyMatch(r -> r.id().equals(roomId)), "newtag should be searchable after patch");

        // oldtag not searchable
        String searchOldAfter = mockMvc.perform(get("/api/search").param("tags", "oldtag-xyz")
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<RoomResponse> afterOld = objectMapper.readValue(searchOldAfter, new TypeReference<>() {});
        assertTrue(afterOld.stream().noneMatch(r -> r.id().equals(roomId)), "oldtag should be excluded after patch");
    }

    // 4. 멘션 파서 및 XSS/이메일 오탐 방어
    @Test
    @DisplayName("Audit-8: 멘션 파서 - @everyone, 이메일 오탐, 없는 사용자")
    void mentionParserAndXSSDefense() throws Exception {
        String host = "audit-host-8";
        String guest = "audit-guest-8";
        String roomId = createRoom(host, "Mention Game", List.of("mention"), 5, RoomType.TEMPORARY);
        // guest join
        mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor(guest))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest(guest))))
                .andExpect(status().isOk());

        SessionResponse hostSess = createSession(host);
        String hostToken = hostSess.token();

        // Subscribe as host to chat topic
        StompTestClient client = new StompTestClient(port, hostToken);
        try {
            client.subscribe("/topic/room/" + roomId + "/chat");
            Thread.sleep(200);

            // 1) @everyone -> mentions should contain both host and guest
            String payloadEveryone = objectMapper.writeValueAsString(Map.of("clientRequestId", "req-every", "content", "hello @everyone"));
            client.send("/app/room/" + roomId + "/chat", payloadEveryone);
            String frameEveryone = client.await(3);
            assertNotNull(frameEveryone, "@everyone should be broadcast");
            String bodyEveryone = extractBody(frameEveryone);
            JsonNode nodeEveryone = objectMapper.readTree(bodyEveryone);
            assertTrue(nodeEveryone.has("mentions"), "mentions field should exist");
            Set<String> mentionsEveryone = Set.copyOf(objectMapper.convertValue(nodeEveryone.get("mentions"), new TypeReference<List<String>>() {}));
            assertTrue(mentionsEveryone.contains(host), "@everyone should include host");
            assertTrue(mentionsEveryone.contains(guest), "@everyone should include guest");

            // 2) email should not be detected as mention
            String payloadEmail = objectMapper.writeValueAsString(Map.of("clientRequestId", "req-email", "content", "contact user@domain.com please"));
            client.send("/app/room/" + roomId + "/chat", payloadEmail);
            String frameEmail = client.await(3);
            assertNotNull(frameEmail);
            String bodyEmail = extractBody(frameEmail);
            JsonNode nodeEmail = objectMapper.readTree(bodyEmail);
            List<String> mentionsEmail = objectMapper.convertValue(nodeEmail.get("mentions"), new TypeReference<>() {});
            assertTrue(mentionsEmail.isEmpty(), "email should not produce mentions");

            // 3) non-member mention should be excluded
            String payloadNotMember = objectMapper.writeValueAsString(Map.of("clientRequestId", "req-not", "content", "hi @notMemberXYZ"));
            client.send("/app/room/" + roomId + "/chat", payloadNotMember);
            String frameNot = client.await(3);
            assertNotNull(frameNot);
            String bodyNot = extractBody(frameNot);
            JsonNode nodeNot = objectMapper.readTree(bodyNot);
            List<String> mentionsNot = objectMapper.convertValue(nodeNot.get("mentions"), new TypeReference<>() {});
            assertTrue(mentionsNot.isEmpty(), "non-member mention should be excluded");

            // 4) valid single mention
            String payloadValid = objectMapper.writeValueAsString(Map.of("clientRequestId", "req-valid", "content", "hi @" + guest + " welcome"));
            client.send("/app/room/" + roomId + "/chat", payloadValid);
            String frameValid = client.await(3);
            assertNotNull(frameValid);
            JsonNode nodeValid = objectMapper.readTree(extractBody(frameValid));
            List<String> mentionsValid = objectMapper.convertValue(nodeValid.get("mentions"), new TypeReference<>() {});
            assertTrue(mentionsValid.contains(guest), "valid member mention should be included");
            assertFalse(mentionsValid.contains("notMemberXYZ"));

            // 5) XSS payload should not break parser (mentions empty)
            String payloadXss = objectMapper.writeValueAsString(Map.of("clientRequestId", "req-xss", "content", "<script>alert(1)</script> hello"));
            client.send("/app/room/" + roomId + "/chat", payloadXss);
            String frameXss = client.await(3);
            assertNotNull(frameXss);
            JsonNode nodeXss = objectMapper.readTree(extractBody(frameXss));
            List<String> mentionsXss = objectMapper.convertValue(nodeXss.get("mentions"), new TypeReference<>() {});
            assertTrue(mentionsXss.isEmpty(), "xss content without @ should have no mentions");

        } finally {
            client.close();
        }
    }

    private String extractBody(String frame) {
        if (frame == null) return "";
        int idx = frame.indexOf("\n\n");
        String body = idx >= 0 ? frame.substring(idx + 2) : frame;
        body = body.replace("\u0000", "").trim();
        // STOMP frames may contain headers; the body is JSON
        // if body still contains STOMP command prefix, try to find first {
        int jsonStart = body.indexOf("{");
        if (jsonStart > 0) body = body.substring(jsonStart);
        // Trim to last }
        int jsonEnd = body.lastIndexOf("}");
        if (jsonEnd >= 0) body = body.substring(0, jsonEnd + 1);
        return body;
    }

    // 5. 이미지 업로드 및 대화 영속성 + 영구방 수정 MariaDB
    @Test
    @DisplayName("Audit-9: 영구방 수정 MariaDB 영속화 및 조회")
    void permanentRoomUpdatePersisted() throws Exception {
        String host = "audit-host-9";
        String roomId = createRoom(host, "Perm Game Old", List.of("old"), 4, RoomType.PERMANENT);

        Map<String, Object> patch = Map.of(
                "title", "Perm Title New",
                "game", "Perm Game New",
                "tags", List.of("newtag1", "newtag2"),
                "capacity", 6
        );
        mockMvc.perform(patch("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(patch)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.game").value("Perm Game New"))
                .andExpect(jsonPath("$.capacity").value(6));

        // DB verification
        Long count = jdbc.sql("SELECT COUNT(*) FROM permanent_room WHERE id = :id")
                .param("id", roomId).query(Long.class).single();
        assertEquals(1L, count);

        Map<String, Object> row = jdbc.sql("SELECT title, game, tags, capacity FROM permanent_room WHERE id = :id")
                .param("id", roomId)
                .query((rs, n) -> {
                    java.util.HashMap<String, Object> m = new java.util.HashMap<>();
                    m.put("title", rs.getString("title") == null ? "" : rs.getString("title"));
                    m.put("game", rs.getString("game"));
                    m.put("tags", rs.getString("tags"));
                    m.put("capacity", rs.getInt("capacity"));
                    return m;
                }).single();
        assertEquals("Perm Game New", row.get("game"));
        assertEquals(6, row.get("capacity"));
        String tagsStr = (String) row.get("tags");
        assertTrue(tagsStr.contains("newtag1") && tagsStr.contains("newtag2"));

        // GET should reflect DB
        RoomResponse after = getRoom(roomId);
        assertEquals("Perm Game New", after.game());
        assertEquals(6, after.capacity());
    }

    @Test
    @DisplayName("Audit-10: 이미지 업로드 후 영구방 대화는 아니지만 업로드 자체 검증 (추가)")
    void imageUploadWorksForMember() throws Exception {
        String host = "audit-host-10";
        String roomId = createRoom(host, "Img Game", List.of("img"), 4, RoomType.TEMPORARY);
        MockMultipartFile file = new MockMultipartFile("file", "test.png", "image/png", new byte[]{(byte)0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A});
        String json = mockMvc.perform(multipart("/api/rooms/" + roomId + "/images")
                        .file(file)
                        .header("Authorization", tokenFor(host)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = objectMapper.readTree(json);
        assertTrue(node.has("url") || node.has("mediaUrl"));
        String url = node.has("url") ? node.get("url").asText() : node.get("mediaUrl").asText();
        assertTrue(url.startsWith("/api/images/"));
    }
}
