package com.talklite.search;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionService;
import com.talklite.room.RoomMapper;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class SearchApiIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RoomMapper roomMapper;

    private RoomResponse createRoom(String game, List<String> tags, RoomScope scope) throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("user-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                game, tags, 5, scope, RoomType.TEMPORARY, "user-host"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class);
    }

    private List<RoomResponse> search(String game, String tags) throws Exception {
        return search(game, tags, null, null);
    }

    private List<RoomResponse> search(String game, String tags, String sort, String order) throws Exception {
        var request = get("/api/search");
        if (game != null) request = request.param("game", game);
        if (tags != null) request = request.param("tags", tags);
        if (sort != null) request = request.param("sort", sort);
        if (order != null) request = request.param("order", order);
        String content = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<>() {
        });
    }

    private Set<String> ids(List<RoomResponse> rooms) {
        return rooms.stream().map(RoomResponse::id).collect(Collectors.toSet());
    }

    private List<String> idList(List<RoomResponse> rooms) {
        return rooms.stream().map(RoomResponse::id).toList();
    }

    @Test
    @DisplayName("게임명 단독 검색: 정확 일치하며 대소문자 무시")
    void gameNameSearchIsCaseInsensitive() throws Exception {
        RoomResponse room = createRoom("Apex Legends", List.of("gs-link-a"), RoomScope.PUBLIC);

        List<RoomResponse> lower = search("apex legends", "");
        assertTrue(ids(lower).contains(room.id()));

        List<RoomResponse> upper = search("APEX LEGENDS", "");
        assertTrue(ids(upper).contains(room.id()));
    }

    @Test
    @DisplayName("태그 교집합: 모든 태그를 가진 방만 반환")
    void tagIntersection() throws Exception {
        RoomResponse dual = createRoom("GameIxn", List.of("ixn-a", "ixn-b"), RoomScope.PUBLIC);
        createRoom("GameIxn", List.of("ixn-a", "ixn-c"), RoomScope.PUBLIC);
        createRoom("GameIxn", List.of("ixn-b", "ixn-c"), RoomScope.PUBLIC);

        List<RoomResponse> result = search("", "ixn-a,ixn-b");
        assertTrue(ids(result).contains(dual.id()));
    }

    @Test
    @DisplayName("비공개 방은 검색 결과에 노출되지 않는다")
    void privateRoomHidden() throws Exception {
        RoomResponse privated = createRoom("GamePriv", List.of("priv-tag"), RoomScope.PRIVATE);

        List<RoomResponse> result = search("", "priv-tag");
        assertFalse(ids(result).contains(privated.id()));
    }

    @Test
    @DisplayName("필터 미지정 시 전체 공개 방을 반환한다")
    void emptyFilterReturnsAllPublicRooms() throws Exception {
        RoomResponse room = createRoom("GameAll", List.of("all-link"), RoomScope.PUBLIC);

        List<RoomResponse> result = search("", "");
        assertTrue(ids(result).contains(room.id()));
    }

    @Test
    @DisplayName("0건 결과는 빈 배열을 반환한다 (에러 아님)")
    void noMatchReturnsEmptyArray() throws Exception {
        List<RoomResponse> result = search("completely-missing-game-xyz", "");
        assertTrue(result.isEmpty());
        assertDoesNotThrow(() -> search("completely-missing-game-xyz", ""));
    }

    private RoomResponse createRoomWithTitle(String title, String game, List<String> tags) throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("user-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                title, game, tags, 5, RoomScope.PUBLIC, RoomType.TEMPORARY, "user-host"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class);
    }

    private List<String> orderedTitles(List<RoomResponse> rooms) {
        return rooms.stream().map(r -> r.title() == null ? "" : r.title()).toList();
    }

    @Test
    @DisplayName("P0-05: sort=title 오름차순 — Null-Safe 대소문자 무시 사전순")
    void sortTitleAscending() throws Exception {
        createRoomWithTitle("Bravo", "SortGame", List.of("s"));
        createRoomWithTitle("alpha", "SortGame", List.of("s"));
        createRoomWithTitle("Charlie", "SortGame", List.of("s"));

        List<RoomResponse> result = search("SortGame", "", "title", "asc");
        assertEquals(List.of("alpha", "Bravo", "Charlie"), orderedTitles(result));
    }

    @Test
    @DisplayName("P0-05: sort=title 내림차순 — Null-Safe 대소문자 무시 역순")
    void sortTitleDescending() throws Exception {
        createRoomWithTitle("Bravo", "SortGame", List.of("s"));
        createRoomWithTitle("alpha", "SortGame", List.of("s"));
        createRoomWithTitle("Charlie", "SortGame", List.of("s"));

        List<RoomResponse> result = search("SortGame", "", "title", "desc");
        assertEquals(List.of("Charlie", "Bravo", "alpha"), orderedTitles(result));
    }

    @Test
    @DisplayName("P0-05: sort=members 정렬 — 참여 인원수 asc/desc")
    void sortMembersAscAndDesc() throws Exception {
        RoomResponse solo = createRoom("SortMembers", List.of("m"), RoomScope.PUBLIC);
        RoomResponse duo = createRoom("SortMembers", List.of("m"), RoomScope.PUBLIC);
        RoomResponse trio = createRoom("SortMembers", List.of("m"), RoomScope.PUBLIC);

        for (String guest : List.of("m-guest-1")) {
            mockMvc.perform(post("/api/rooms/" + duo.id() + "/join")
                            .header("Authorization", tokenFor(guest))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new com.talklite.room.JoinRequest(guest))))
                    .andExpect(status().isOk());
        }
        for (String guest : List.of("m-guest-2", "m-guest-3")) {
            mockMvc.perform(post("/api/rooms/" + trio.id() + "/join")
                            .header("Authorization", tokenFor(guest))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new com.talklite.room.JoinRequest(guest))))
                    .andExpect(status().isOk());
        }

        List<RoomResponse> asc = search("SortMembers", "", "members", "asc");
        assertEquals(List.of(solo.id(), duo.id(), trio.id()), idList(asc));

        List<RoomResponse> desc = search("SortMembers", "", "members", "desc");
        assertEquals(List.of(trio.id(), duo.id(), solo.id()), idList(desc));
    }

    @Test
    @DisplayName("P0-05: sort=latest 정렬 — 생성일 기준 asc/desc (무파라미터 기본값 desc)")
    void sortLatestAscAndDesc() throws Exception {
        createRoomWithTitle("First", "SortLatest", List.of("l"));
        Thread.sleep(5);
        createRoomWithTitle("Second", "SortLatest", List.of("l"));
        Thread.sleep(5);
        createRoomWithTitle("Third", "SortLatest", List.of("l"));

        List<RoomResponse> asc = search("SortLatest", "", "latest", "asc");
        assertEquals(List.of("First", "Second", "Third"), orderedTitles(asc));

        List<RoomResponse> desc = search("SortLatest", "", "latest", "desc");
        assertEquals(List.of("Third", "Second", "First"), orderedTitles(desc));

        // 무파라미터 하위 호환 — 기본값 latest/desc
        List<RoomResponse> noParam = search("SortLatest", "", null, null);
        assertEquals(List.of("Third", "Second", "First"), orderedTitles(noParam));
    }

    @Test
    @DisplayName("P0-05: sort/order 대소문자 무시 정규화 (TITLE / DESC)")
    void sortCaseInsensitive() throws Exception {
        createRoomWithTitle("Bravo", "SortCase", List.of("c"));
        createRoomWithTitle("Alpha", "SortCase", List.of("c"));

        List<RoomResponse> result = search("SortCase", "", "TITLE", "DESC");
        assertEquals(List.of("Bravo", "Alpha"), orderedTitles(result));
    }

    @Test
    @DisplayName("P0-05: 화이트리스트 위반 sort는 400 invalid_sort")
    void invalidSortReturns400() throws Exception {
        mockMvc.perform(get("/api/search").param("sort", "foo"))
                .andExpect(status().isBadRequest())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.error").value("invalid_sort"));
    }

    @Test
    @DisplayName("P0-05: 화이트리스트 위반 order는 400 invalid_order")
    void invalidOrderReturns400() throws Exception {
        mockMvc.perform(get("/api/search").param("order", "ascending"))
                .andExpect(status().isBadRequest())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.error").value("invalid_order"));
    }

    @Test
    @DisplayName("P0-03: 검색 결과에 title 포함 (null 방어 3-arg 전환)")
    void searchResultIncludesTitle() throws Exception {
        RoomResponse room = createRoomWithTitle("다이아 승급전 구함", "SearchTitle", List.of("t"));
        List<RoomResponse> result = search("SearchTitle", "");
        assertTrue(result.stream().anyMatch(r -> r.id().equals(room.id()) && "다이아 승급전 구함".equals(r.title())));
    }

    @Test
    @DisplayName("P1-04: title null 혼합 정렬 — null(=\"\")이 title asc 선두 배치")
    void sortTitleMixedNullAndExplicit() throws Exception {
        // 명시적 title 방 2개
        createRoomWithTitle("Bravo", "SortNullMixed", List.of("nmx"));
        createRoomWithTitle("Alpha", "SortNullMixed", List.of("nmx"));
        // 레거시 null title 방: 생성 후 Redis hash에서 title 필드 제거
        RoomResponse legacy = createRoom("SortNullMixed", List.of("nmx"), RoomScope.PUBLIC);
        redis.opsForHash().delete(roomMapper.metaKey(legacy.id()), "title");

        List<RoomResponse> result = search("SortNullMixed", "", "title", "asc");
        // null → "" 이므로 사전순 선두
        assertEquals(List.of("", "Alpha", "Bravo"), orderedTitles(result));
    }
}
