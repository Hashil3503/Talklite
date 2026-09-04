package com.talklite.room;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.talklite.auth.SessionRequest;
import com.talklite.auth.SessionResponse;
import com.talklite.realtime.PresenceEventListener;
import com.talklite.realtime.StompTestClient;
import com.talklite.test.IntegrationTestCleanup;
import com.talklite.voice.VoiceRoomFullException;
import com.talklite.voice.VoiceService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.messaging.support.GenericMessage;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class DefectRemediationIntegrationTest extends IntegrationTestCleanup {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RoomService roomService;

    @Autowired
    private RoomMapper roomMapper;

    @Autowired
    private VoiceService voiceService;

    @Autowired
    private PresenceEventListener presenceEventListener;

    @LocalServerPort
    private int port;

    @Test
    @DisplayName("실제 런타임 검증 1 [DEF-01]: 토큰 없이 또는 위조된 actor로 요청 시 즉시 401/403 차단")
    void verifyDef01AuthenticationEnforcement() throws Exception {
        // 1. 토큰 없이 방 생성 시도 -> 401 Unauthorized
        CreateRoomRequest req = new CreateRoomRequest("Val", List.of("fps"), 4, RoomScope.PUBLIC, RoomType.TEMPORARY, "h1");
        mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized());

        // 2. 정상 토큰으로 방 생성
        String res = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("h1"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(res, RoomResponse.class).id();

        // 3. 비인가자(g1)가 방장(h1) 행세를 하며 방 삭제 시도 -> 403 Forbidden
        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor("g1"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"h1\"}"))
                .andExpect(status().isForbidden());

        // 4. 방이 삭제되지 않고 그대로 유지되는지 확인
        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("실제 런타임 검증 2 [DEF-02]: 0명 영구방 고아화 후 새로운 유저 입장 시 방장(👑) 자동 승계")
    void verifyDef02OrphanedHostPromotion() throws Exception {
        // 1. 영구방 생성 (host: initial-host)
        CreateRoomRequest req = new CreateRoomRequest("StarCraft", List.of("ladder"), 4, RoomScope.PUBLIC, RoomType.PERMANENT, "initial-host");
        String res = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("initial-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(res, RoomResponse.class).id();

        // 2. 유일 인원인 initial-host 퇴장 -> 방 인원 0명 도달 및 orphan=true 마킹
        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("initial-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("initial-host"))))
                .andExpect(status().isOk());

        assertTrue(roomMapper.isOrphan(roomId), "0명 영구방은 orphan 마킹되어야 함");

        // 3. 완전히 새로운 유저 new-hero가 0명 고아 영구방에 입장
        String joinRes = mockMvc.perform(post("/api/rooms/" + roomId + "/join")
                        .header("Authorization", tokenFor("new-hero"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("new-hero"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.host").value("new-hero")) // 방장 승계 확인!
                .andExpect(jsonPath("$.count").value(1))
                .andReturn().getResponse().getContentAsString();

        RoomResponse joinedRoom = objectMapper.readValue(joinRes, RoomResponse.class);
        assertEquals("new-hero", joinedRoom.host(), "최초 입장 유저가 새로운 방장이 되어야 함");
        assertFalse(roomMapper.isOrphan(roomId), "입장 후 orphan 마킹 해제되어야 함");

        // 4. 새로운 방장 new-hero는 정상적으로 방을 삭제할 수 있음
        mockMvc.perform(delete("/api/rooms/" + roomId)
                        .header("Authorization", tokenFor("new-hero"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"actor\":\"new-hero\"}"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/rooms/" + roomId))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("실제 런타임 검증 3 [DEF-03]: WebSocket 세션 단절 시 PresenceEventListener에 의한 음성 자동 정리")
    void verifyDef03PresenceDisconnectAutoCleanup() throws Exception {
        // 1. 방 생성 및 음성 참여
        CreateRoomRequest req = new CreateRoomRequest("Voice Game", List.of("voice"), 6, RoomScope.PUBLIC, RoomType.TEMPORARY, "v-host");
        String res = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("v-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(res, RoomResponse.class).id();

        voiceService.start(roomId, "v-host");
        assertTrue(voiceService.getVoiceMembers(roomId).contains("v-host"), "음성 참여 확인");

        // 2. WebSocket 비정상 단절(Disconnect) 이벤트 모의 발행
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.DISCONNECT);
        accessor.setSessionId("mock-session-123");
        Map<String, Object> sessionAttrs = new HashMap<>();
        sessionAttrs.put("roomId", roomId);
        sessionAttrs.put("user", "v-host");
        accessor.setSessionAttributes(sessionAttrs);

        GenericMessage<byte[]> message = new GenericMessage<>(new byte[0], accessor.getMessageHeaders());
        SessionDisconnectEvent disconnectEvent = new SessionDisconnectEvent(this, message, "mock-session-123", null);

        // 3. 리스너 실행
        presenceEventListener.onDisconnect(disconnectEvent);

        // 4. 음성 참여 목록에서 v-host가 원자적으로 제거되었는지 확인
        assertFalse(voiceService.getVoiceMembers(roomId).contains("v-host"), "단절 후 음성 참여자 목록에서 자동 제거되어야 함");
    }

    @Test
    @DisplayName("실제 런타임 검증 4 [DEF-06]: voice_join.lua 원자적 6인 정원 상한 가드")
    void verifyDef06VoiceJoinLuaCapacityGuard() throws Exception {
        CreateRoomRequest req = new CreateRoomRequest("Cap Game", List.of("cap"), 6, RoomScope.PUBLIC, RoomType.TEMPORARY, "cap-host");
        String res = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("cap-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(res, RoomResponse.class).id();

        // 6명 음성 참여
        for (int i = 1; i <= 6; i++) {
            voiceService.start(roomId, "user-" + i);
        }
        assertEquals(6, voiceService.getVoiceMembers(roomId).size());

        // 7번째 유저 음성 참여 시도 -> VoiceRoomFullException 원자 차단
        assertThrows(VoiceRoomFullException.class, () -> voiceService.start(roomId, "user-7"));
        assertEquals(6, voiceService.getVoiceMembers(roomId).size(), "6인을 초과할 수 없음");
    }

    @Test
    @DisplayName("실제 런타임 검증 5 [DEF-04]: 태그 대소문자 무관 검색 및 GC 일치 확인")
    void verifyDef04CaseInsensitiveSearchAndGc() throws Exception {
        // 대문자 혼용 태그 #RankedGame 생성
        CreateRoomRequest req = new CreateRoomRequest("Valorant", List.of("RankedGame"), 5, RoomScope.PUBLIC, RoomType.TEMPORARY, "val-host");
        String res = mockMvc.perform(post("/api/rooms")
                        .header("Authorization", tokenFor("val-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String roomId = objectMapper.readValue(res, RoomResponse.class).id();

        // 소문자 #rankedgame 및 대문자 #RANKEDGAME 검색 모두 조회 성공 확인
        mockMvc.perform(get("/api/search?tags=rankedgame"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(roomId));

        mockMvc.perform(get("/api/search?tags=RANKEDGAME"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(roomId));

        // 퇴장 시 GC 소멸
        mockMvc.perform(post("/api/rooms/" + roomId + "/leave")
                        .header("Authorization", tokenFor("val-host"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinRequest("val-host"))))
                .andExpect(status().isOk());

        // 역색인 완전 소멸 확인 (유령 색인 없음)
        assertFalse(Boolean.TRUE.equals(redis.opsForSet().isMember("tag:rankedgame:rooms", roomId)));
        mockMvc.perform(get("/api/search?tags=rankedgame"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }
}
