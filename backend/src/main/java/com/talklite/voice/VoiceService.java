package com.talklite.voice;

import com.talklite.realtime.RoomEventPublisher;
import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class VoiceService {

    public static final int MAX_VOICE_MEMBERS = 6;

    private final RoomMapper roomMapper;
    private final RoomEventPublisher eventPublisher;

    public VoiceService(RoomMapper roomMapper, RoomEventPublisher eventPublisher) {
        this.roomMapper = roomMapper;
        this.eventPublisher = eventPublisher;
    }

    public void start(String roomId, String user) {
        Room room = roomMapper.find(roomId);
        if (room == null) {
            return;
        }
        // 6인 정원 가드: 이미 음성 참여자가 아니면서 정원을 초과하면 거부 (WebRTC Mesh 상한)
        if (!roomMapper.isVoiceMember(roomId, user) && roomMapper.voiceCount(roomId) >= MAX_VOICE_MEMBERS) {
            return;
        }
        roomMapper.addVoice(roomId, user);
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
