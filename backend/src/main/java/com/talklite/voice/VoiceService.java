package com.talklite.voice;

import com.talklite.realtime.RoomEventPublisher;
import com.talklite.room.Room;
import com.talklite.room.RoomMapper;
import org.springframework.stereotype.Service;

@Service
public class VoiceService {

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
}
