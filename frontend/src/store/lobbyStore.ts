import { create } from 'zustand'
import { searchRooms, type RoomResponse, type SearchField } from '../lib/api'

export type SortKey = 'latest' | 'title' | 'members'
export type SortOrder = 'asc' | 'desc'

interface LobbyState {
  game: string
  tags: string[]
  preset: string
  field: SearchField
  sort: SortKey
  order: SortOrder
  rooms: RoomResponse[]
  loading: boolean
  error: string | null
  search: (game: string, tags: string[], sort?: SortKey, order?: SortOrder, q?: string, field?: SearchField) => Promise<void>
  refresh: () => Promise<void>
  setGame: (game: string) => void
  setPreset: (preset: string) => void
  setField: (field: SearchField) => void
  setSort: (sort: SortKey) => void
  setOrder: (order: SortOrder) => void
  toggleTag: (tag: string) => void
  handleRoomUpdated: (event: any) => void
}

export const useLobbyStore = create<LobbyState>((set, get) => ({
  game: '',
  tags: [],
  preset: '',
  field: 'all',
  sort: 'latest',
  order: 'desc',
  rooms: [],
  loading: false,
  error: null,
  setGame: (game) => set({ game }),
  setPreset: (preset) => set({ preset }),
  setField: (field) => set({ field }),
  setSort: (sort) => set({ sort }),
  setOrder: (order) => set({ order }),
  toggleTag: (tag) => {
    const tags = get().tags
    set({ tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] })
  },
  search: async (game, tags, sort = 'latest', order = 'desc', q, field) => {
    set({ loading: true, error: null })
    try {
      const rooms = await searchRooms({ game: game || undefined, tags: tags.length ? tags.join(',') : undefined, q: q || undefined, field, sort, order })
      set({ rooms, loading: false })
    } catch {
      // 서버 최초 기동/일시적 네트워크 지연 시에도 자연스러운 "개설된 공개 방이 없습니다" 안내를 위해 무음 처리
      set({ rooms: [], loading: false, error: null })
    }
  },
  // 현재 검색 조건(프리셋·검색어·범위·정렬) 그대로 재검색 — 실시간 로비 갱신용
  refresh: () => {
    const s = get()
    return s.search(s.preset, s.tags, s.sort, s.order, s.game.trim(), s.field)
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