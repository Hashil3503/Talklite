import { useEffect, useState } from 'react'
import { useDebounce } from '../lib/debounce'
import { useLobbyStore, type SortKey, type SortOrder } from '../store/lobbyStore'

const GAME_PRESETS = [
  { label: '전체', game: '' },
  { label: '리그 오브 레전드', game: '리그 오브 레전드' },
  { label: '발로란트', game: '발로란트' },
  { label: '배틀그라운드', game: '배틀그라운드' },
  { label: '오버워치 2', game: '오버워치 2' },
]

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: '최신순', value: 'latest-desc' },
  { label: '오래된순', value: 'latest-asc' },
  { label: '제목 오름차순', value: 'title-asc' },
  { label: '제목 내림차순', value: 'title-desc' },
  { label: '인원 오름차순', value: 'members-asc' },
  { label: '인원 내림차순', value: 'members-desc' },
]

function valueToSort(value: string): { sort: SortKey; order: SortOrder } {
  const [sort, order] = value.split('-')
  return { sort: sort as SortKey, order: order as SortOrder }
}

export function SearchBar() {
  const { game, tags, preset, sort, order, setGame, setPreset, setSort, setOrder, search } = useLobbyStore()
  const [gameInput, setGameInput] = useState(game)
  const debouncedQuery = useDebounce(gameInput, 300)

  const sortedValue = `${sort}-${order}`

  // 프리셋 탭이 활성화된 경우: game=프리셋, 텍스트 쿼리는 태그로 AND 결합
  // 프리셋이 '전체'인 경우: 텍스트 쿼리를 game 검색으로 사용
  useEffect(() => {
    const presetGame = preset
    if (presetGame) {
      const query = debouncedQuery.trim()
      search(presetGame, query ? [query] : tags, sort, order)
    } else {
      search(debouncedQuery.trim(), tags, sort, order)
    }
  }, [debouncedQuery, tags, preset, sort, order, search])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {GAME_PRESETS.map((p) => (
          <button
            key={p.game}
            onClick={() => setPreset(p.game)}
            aria-pressed={preset === p.game}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === p.game
                ? 'border-[rgba(80,194,243,0.5)] bg-[#50C2F3]/15 text-[#50C2F3]'
                : 'border-[rgba(255,255,255,0.08)] bg-[#121217] text-zinc-400 hover:border-[rgba(255,255,255,0.18)] hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">🔍</span>
          <input
            type="text"
            value={gameInput}
            onChange={(e) => {
              setGameInput(e.target.value)
              setGame(e.target.value)
            }}
            placeholder={preset ? "태그 검색 — 프리셋 선택 시 태그로 매칭 (300ms 디바운스)..." : "게임명 또는 태그 검색 (300ms 디바운스)..."}
            className="w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#121217] py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[rgba(80,194,243,0.5)]"
          />
        </div>

        <select
          value={sortedValue}
          onChange={(e) => {
            const { sort: nextSort, order: nextOrder } = valueToSort(e.target.value)
            setSort(nextSort)
            setOrder(nextOrder)
          }}
          aria-label="정렬 기준"
          className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#121217] px-3 py-2.5 text-xs font-semibold text-zinc-300 outline-none focus:border-[rgba(80,194,243,0.5)]"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#171720]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}