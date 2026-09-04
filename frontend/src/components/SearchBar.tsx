import { useEffect, useState } from 'react'
import { useDebounce } from '../lib/debounce'
import { GAME_PRESETS } from '../lib/gamePresets'
import { useLobbyStore } from '../store/lobbyStore'

function resolveQuery(preset: string, query: string, tags: string[]) {
  if (preset) {
    const trimmed = query.trim()
    return { game: preset, tags: trimmed ? [trimmed] : tags }
  }
  return { game: query.trim(), tags }
}

export function SearchBar() {
  const { game, tags, preset, sort, order, setGame, setPreset, search } = useLobbyStore()
  const [gameInput, setGameInput] = useState(game)
  const debouncedQuery = useDebounce(gameInput, 300)

  // 300ms 디바운스 자동 검색 (프리셋 탭과 텍스트 쿼리 AND 결합)
  useEffect(() => {
    const { game: g, tags: t } = resolveQuery(preset, debouncedQuery, tags)
    search(g, t, sort, order)
  }, [debouncedQuery, tags, preset, sort, order, search])

  // 수동 검색 제출 (Enter / [검색] 버튼)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const { game: g, tags: t } = resolveQuery(preset, gameInput, tags)
    search(g, t, sort, order)
  }

  const inputPlaceholder = preset
    ? '태그 검색 — 프리셋 선택 시 태그로 매칭 (300ms 디바운스)...'
    : '게임명 또는 태그 검색 (300ms 디바운스)...'

  const inputAriaLabel = preset ? '태그 검색' : '게임명 또는 태그 검색'

  return (
    <div className="search-container">
      <form className="search-bar" onSubmit={handleSubmit} role="search">
        <span className="search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          type="text"
          className="search-input"
          placeholder={inputPlaceholder}
          aria-label={inputAriaLabel}
          value={gameInput}
          onChange={(e) => {
            setGameInput(e.target.value)
            setGame(e.target.value)
          }}
        />
        <button type="submit" className="btn-search">
          검색
        </button>
      </form>

      <div className="game-tag-filters" role="tablist" aria-label="게임 프리셋 필터">
        {GAME_PRESETS.map((p) => (
          <button
            key={p.game}
            role="tab"
            aria-selected={preset === p.game}
            className={`tag-filter-btn ${preset === p.game ? 'active' : ''}`}
            onClick={() => setPreset(p.game)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}