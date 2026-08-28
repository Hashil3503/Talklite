-- Talklite update_room.lua — 방 정보 원자적 수정 + 역색인 재색인 (Phase 11)
-- KEYS[1]: room:{id}:meta
-- KEYS[2]: room:{id}:members
-- KEYS[3]: room:{id}:voice
-- ARGV[1]: roomId
-- ARGV[2]: title
-- ARGV[3]: game
-- ARGV[4]: capacity
-- ARGV[5]: tagsJson (comma-separated, lowercased, e.g. "fps,rank,voice")
-- ARGV[6]: updatedAt (epoch millis)
--
-- 반환:
--   1  성공
--  -1  ERR_NOT_FOUND (방 없음)
--  -2  ERR_CAPACITY_CONFLICT (정원 < 현재 인원/보이스)

if redis.call('EXISTS', KEYS[1]) == 0 then
    return -1 -- ERR_NOT_FOUND
end

local newCapacity = tonumber(ARGV[4])
local memberCount = redis.call('SCARD', KEYS[2])
local voiceCount = redis.call('SCARD', KEYS[3])
if memberCount > newCapacity or voiceCount > newCapacity then
    return -2 -- ERR_CAPACITY_CONFLICT
end

local oldGame = redis.call('HGET', KEYS[1], 'game')
local oldTagsStr = redis.call('HGET', KEYS[1], 'tags')
local scope = redis.call('HGET', KEYS[1], 'scope')

-- helper: split comma string into set table
local function splitTags(str)
    local t = {}
    if str and #str > 0 then
        for tag in string.gmatch(str, '([^,]+)') do
            tag = string.lower(tag)
            -- trim
            tag = tag:gsub('^%s+', ''):gsub('%s+$', '')
            if #tag > 0 then
                t[tag] = true
            end
        end
    end
    return t
end

local oldTags = splitTags(oldTagsStr)
local newTags = splitTags(ARGV[5])

-- PUBLIC 방만 역색인 관리 (PRIVATE는 검색 노출 안됨)
if scope == 'PUBLIC' then
    -- game 재색인
    if oldGame then
        local oldLower = string.lower(oldGame)
        local newLower = string.lower(ARGV[3])
        if oldLower ~= newLower then
            if #oldLower > 0 then
                redis.call('SREM', 'game:' .. oldLower .. ':rooms', ARGV[1])
            end
            if #newLower > 0 then
                redis.call('SADD', 'game:' .. newLower .. ':rooms', ARGV[1])
            end
        end
    else
        if ARGV[3] and #ARGV[3] > 0 then
            redis.call('SADD', 'game:' .. string.lower(ARGV[3]) .. ':rooms', ARGV[1])
        end
    end

    -- tag 재색인: old 중 new에 없는 것 SREM, new 중 old에 없는 것 SADD
    for tag, _ in pairs(oldTags) do
        if not newTags[tag] then
            redis.call('SREM', 'tag:' .. tag .. ':rooms', ARGV[1])
        end
    end
    for tag, _ in pairs(newTags) do
        if not oldTags[tag] then
            redis.call('SADD', 'tag:' .. tag .. ':rooms', ARGV[1])
        end
    end
end

-- meta 갱신 (title, game, capacity, tags, updatedAt)
redis.call('HSET', KEYS[1],
    'game', ARGV[3],
    'capacity', ARGV[4],
    'tags', ARGV[5],
    'updatedAt', ARGV[6])
if ARGV[2] and #ARGV[2] > 0 then
    redis.call('HSET', KEYS[1], 'title', ARGV[2])
end
-- updated_at 레거시 필드도 함께 갱신 (호환)
redis.call('HSET', KEYS[1], 'updated_at', ARGV[6])

return 1
