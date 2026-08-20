import { useEffect, useState } from 'react'
import { useDebounce } from '../lib/debounce'
import { useLobbyStore } from '../store/lobbyStore'

const SUGGESTED_TAGS = ['solo', 'fps', 'rpg', '듀오', '스쿼드', '랭크', '캐주얼']

export function SearchBar() {
  const { game, tags, setGame, toggleTag, search } = useLobbyStore()
  const [gameInput, setGameInput] = useState(game)
  const debouncedGame = useDebounce(gameInput, 700)

  useEffect(() => {
    search(debouncedGame, tags)
  }, [debouncedGame, tags, search])

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <input
        type="text"
        value={gameInput}
        onChange={(e) => {
          setGameInput(e.target.value)
          setGame(e.target.value)
        }}
        placeholder="게임명 검색..."
        className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-neutral-100 outline-none focus:border-emerald-500"
      />
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
              tags.includes(tag)
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500'
            }`}
          >
            #{tag}
          </button>
        ))}
      </div>
    </div>
  )
}
