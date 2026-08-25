-- Talklite gc.lua — 마지막 인원 퇴장 시 방 키 + 역색인 원자적 파기 (FR-ROOM-02, T-02)
-- GC-Join 2중 상호 배제 가드 중 하나: SCARD(members) != 0 이면 파기 취소(return 0).
-- KEYS[1]: room:{id}:meta
-- KEYS[2]: room:{id}:members
-- KEYS[3]: room:{id}:joined_at
-- KEYS[4]: room:{id}:voice
-- KEYS[5]: room:{id}:banned
-- KEYS[6]: room:{id}:invite
-- ARGV[1]: roomId
-- ARGV[2]: game
-- ARGV[3..]: tags
--
-- 반환 코드:
--   1  파기 성공
--   0  멤버 존재(동시 입장) → 파기 취소

if redis.call('SCARD', KEYS[2]) ~= 0 then
    return 0
end

-- 초대코드 역방향(room:{id}:invite → invite:{code}) 정리
local code = redis.call('GET', KEYS[6])
if code then
    redis.call('DEL', 'invite:' .. code)
end

-- 게임명/태그 역색인에서 제거 (소문자 정규화, RoomMapper.gameIndexKey 규약과 일치)
redis.call('SREM', 'game:' .. string.lower(ARGV[2]) .. ':rooms', ARGV[1])
for i = 3, #ARGV do
    if #ARGV[i] > 0 then
        redis.call('SREM', 'tag:' .. string.lower(ARGV[i]) .. ':rooms', ARGV[1])
    end
end

redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
return 1
