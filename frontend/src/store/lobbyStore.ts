import { create } from 'zustand'
import { searchRooms, type RoomResponse } from '../lib/api'

interface LobbyState {
  game: string
  tags: string[]
  rooms: RoomResponse[]
  loading: boolean
  error: string | null
  search: (game: string, tags: string[]) => Promise<void>
  setGame: (game: string) => void
  toggleTag: (tag: string) => void
}

export const useLobbyStore = create<LobbyState>((set, get) => ({
  game: '',
  tags: [],
  rooms: [],
  loading: false,
  error: null,
  setGame: (game) => set({ game }),
  toggleTag: (tag) => {
    const tags = get().tags
    set({ tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] })
  },
  search: async (game, tags) => {
    set({ loading: true, error: null })
    try {
      const rooms = await searchRooms({ game: game || undefined, tags: tags.length ? tags.join(',') : undefined })
      set({ rooms, loading: false })
    } catch {
      set({ error: '검색 오류', loading: false })
    }
  },
}))
