import { useEffect, useState } from 'react'
import { useDebounce } from '../lib/debounce'
import { GAME_PRESETS } from '../lib/gamePresets'
import { useLobbyStore } from '../store/lobbyStore'
import type { SearchField } from '../lib/api'

const FIELD_PLACEHOLDERS: Record<SearchField, string> = {
  all: '게임명·제목·태그 검색 (300ms 디바운스)...',
  game: '게임명 검색 (300ms 디바운스)...',
  title: '제목 검색 (300ms 디바운스)...',
  tag: '태그 검색 (300ms 디바운스)...',
}

export function SearchBar() {
  const { game, tags, preset, field, sort, order, setGame, setPreset, setField, search } = useLobbyStore()
  const [gameInput, setGameInput] = useState(game)
  const debouncedQuery = useDebounce(gameInput, 300)

  // 300ms 디바운스 자동 검색 (프리셋은 game 필터, 입력은 q 파라미터)
  useEffect(() => {
    search(preset, tags, sort, order, debouncedQuery.trim(), field)
  }, [debouncedQuery, tags, preset, field, sort, order, search])

  // 수동 검색 제출 (Enter / [검색] 버튼)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    search(preset, tags, sort, order, gameInput.trim(), field)
  }

  return (
    <div className="search-container">
      <form className="search-bar" onSubmit={handleSubmit} role="search">
        <span className="search-icon" aria-hidden="true">
          🔍
        </span>
        <select
          className="search-field-select"
          aria-label="검색 범위"
          value={field}
          onChange={(e) => setField(e.target.value as SearchField)}
        >
          <option value="all">전체</option>
          <option value="game">게임명</option>
          <option value="title">제목</option>
          <option value="tag">태그</option>
        </select>
        <input
          type="text"
          className="search-input"
          placeholder={FIELD_PLACEHOLDERS[field]}
          aria-label="검색어"
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
