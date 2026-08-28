-- Talklite voice_join.lua — WebRTC 음성 정원(6인) 원자적 가드 (DEF-06)
-- KEYS[1]: room:{id}:voice
-- KEYS[2]: room:{id}:meta
-- ARGV[1]: user
-- ARGV[2]: max (6)
--
-- 반환 코드:
--   1  성공 (신규 참여 또는 이미 참여 — 멱등)
--  -1  정원 초과 (VoiceRoomFullException)
--  -2  방 없음 (RoomNotFoundException)

if redis.call('EXISTS', KEYS[2]) == 0 then
    return -2
end

if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
    return 1
end

if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then
    return -1
end

redis.call('SADD', KEYS[1], ARGV[1])
return 1
