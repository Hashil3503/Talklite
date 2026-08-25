-- Talklite join.lua — 원자적 정원 검증 + 밴 검사 + 입장 처리 (FR-CONC-01/02)
-- GC-Join 2중 상호 배제 가드 중 하나: 방이 파기된 상태면 입장 거부(return -4)
-- KEYS[1]: room:{id}:members
-- KEYS[2]: room:{id}:joined_at
-- KEYS[3]: room:{id}:banned
-- KEYS[4]: room:{id}:banned:{user}
-- KEYS[5]: room:{id}:meta  (파기 여부 판별용)
-- ARGV[1]: user
-- ARGV[2]: capacity
-- ARGV[3]: timestamp (epoch millis)
--
-- 반환 코드:
--   1  성공 (신규 입장 또는 이미 멤버인 재입장 — 멱등)
--  -1  정원 초과 (409 room_full)
--  -2  영구 밴 (403 user_banned)
--  -3  임시 밴 (403 user_banned)
--  -4  방 파기됨 (404 room_not_found) — gc.lua와 상호 배제 (T-02)

-- 0. 방 파기 검사 (GC 완료 직후 잔입장/고아 키 생성 방지)
if redis.call('EXISTS', KEYS[5]) == 0 then
    return -4
end

-- 1. 영구 밴 여부 검사
if redis.call('SISMEMBER', KEYS[3], ARGV[1]) == 1 then
    return -2
end

-- 2. 임시 밴 여부 검사 (TTL 잔여)
if redis.call('EXISTS', KEYS[4]) == 1 then
    return -3
end

-- 3. 이미 방 멤버인 경우 재입장 허용 (멱등성)
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
    return 1
end

-- 4. 정원 초과 여부 검사
local count = redis.call('SCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then
    return -1
end

-- 5. 입장 처리 (멤버 추가 + 체류 시간 기록)
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 1
