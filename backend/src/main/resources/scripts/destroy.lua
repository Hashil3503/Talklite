-- Talklite Phase 7: 방장 전용 방 완전 강제 파기 (destroy.lua)
-- 멤버 수(SCARD)와 무관하게 모든 관련 키를 원자적으로 일괄 제거한다.
--
-- KEYS[1]: room:{id}:meta
-- KEYS[2]: room:{id}:members
-- KEYS[3]: room:{id}:joined_at
-- KEYS[4]: room:{id}:voice
-- KEYS[5]: room:{id}:banned
-- KEYS[6]: room:{id}:invite (방 ID -> 초대코드 역방향 매핑)
-- KEYS[7]: room:{id}:messages (채팅 대화 내역 캐시 List)
--
-- ARGV[1]: roomId
-- ARGV[2]: game (정규화 전 원본 게임명, 소문자 처리는 Lua 내부에서 수행)
-- ARGV[3..N]: tags (태그 목록)
--
-- 1. 역방향 초대코드 매핑(room:{id}:invite)을 읽어 실제 invite:{code} 키를 함께 DEL
local code = redis.call('GET', KEYS[6])
if code then
    redis.call('DEL', 'invite:' .. code)
end

-- 2. 게임명 및 태그 역색인 Set에서 roomId 제거 (소문자 정규화 일관성 유지)
if ARGV[2] and #ARGV[2] > 0 then
    redis.call('SREM', 'game:' .. string.lower(ARGV[2]) .. ':rooms', ARGV[1])
end
for i = 3, #ARGV do
    if #ARGV[i] > 0 then
        redis.call('SREM', 'tag:' .. string.lower(ARGV[i]) .. ':rooms', ARGV[1])
    end
end

-- 3. 방에 속한 모든 핵심 키 일괄 삭제
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
return 1