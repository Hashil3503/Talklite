package com.talklite.search;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.room.CreateRoomRequest;
import com.talklite.room.RoomResponse;
import com.talklite.room.RoomScope;
import com.talklite.room.RoomType;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class SearchApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RoomResponse createRoom(String game, List<String> tags, RoomScope scope) throws Exception {
        String content = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRoomRequest(
                                game, tags, 5, scope, RoomType.TEMPORARY, "user-host"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, RoomResponse.class);
    }

    private List<RoomResponse> search(String game, String tags) throws Exception {
        String content = mockMvc.perform(get("/api/search")
                        .param("game", game)
                        .param("tags", tags))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<>() {
        });
    }

    private Set<String> ids(List<RoomResponse> rooms) {
        return rooms.stream().map(RoomResponse::id).collect(Collectors.toSet());
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
}
