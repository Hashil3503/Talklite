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
  handleRoomUpdated: (event: any) => void
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
  handleRoomUpdated: (event: any) => {
    if (!event || event.type !== 'ROOM_UPDATED') return
    const data = event.data ?? event.extra ?? {}
    const roomId: string = event.roomId
    if (!roomId) return
    const title = (data.title ?? event.title) as string | undefined
    const game = (data.game ?? event.game) as string | undefined
    const tags = (data.tags ?? event.tags) as string[] | undefined
    const capacity = (data.capacity ?? event.capacity) as number | undefined
    set((state) => {
      const idx = state.rooms.findIndex((r) => r.id === roomId)
      if (idx === -1) return state
      const updated = { ...state.rooms[idx] }
      if (title !== undefined) (updated as any).title = title
      if (game !== undefined) updated.game = game
      if (Array.isArray(tags)) updated.tags = tags
      if (typeof capacity === 'number') updated.capacity = capacity
      const next = [...state.rooms]
      next[idx] = updated
      return { rooms: next }
    })
  },
}))
