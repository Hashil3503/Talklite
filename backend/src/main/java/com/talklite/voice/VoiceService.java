package com.talklite.voice;

import com.talklite.realtime.RoomEventPublisher;
import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import com.talklite.room.RoomNotFoundException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class VoiceService {

    public static final int MAX_VOICE_MEMBERS = 6;

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;
    private final StringRedisTemplate redis;
    private final DefaultRedisScript<Long> voiceJoinScript;

    public VoiceService(RoomMapper roomMapper, RoomEventPublisher eventPublisher,
                        StringRedisTemplate redis,
                        @Qualifier("voiceJoinScript") DefaultRedisScript<Long> voiceJoinScript) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
        this.redis = redis;
        this.voiceJoinScript = voiceJoinScript;
    }

    public void start(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            throw new RoomNotFoundException(roomId);
        }
        // 원자적 음성 정원 가드 (voice_join.lua)
        Long result = redis.execute(
                voiceJoinScript,
                List.of(roomMapper.voiceKey(roomId), roomMapper.metaKey(roomId)),
                user, String.valueOf(MAX_VOICE_MEMBERS)
        );
        long code = result == null ? 1L : result;
        if (code == -2L) {
            throw new RoomNotFoundException(roomId);
        }
        if (code == -1L) {
            throw new VoiceRoomFullException();
        }
        // code == 1 : 성공(신규 또는 멱등 재참여) → 이벤트 발행
        eventPublisher.publishVoice(room, user);
    }

    public void end(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            return;
        }
        roomMapper.removeVoice(roomId, user);
        eventPublisher.publishVoice(room, user);
    }

    public List<String> getVoiceMembers(String roomId) {
        return roomMapper.voiceMembers(roomId);
    }
}
