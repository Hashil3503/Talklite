export type RoomScope = 'PUBLIC' | 'PRIVATE'
export type RoomType = 'TEMPORARY' | 'PERMANENT'

export interface RoomResponse {
  id: string
  game: string
  tags: string[]
  capacity: number
  scope: RoomScope
  type: RoomType
  host: string
  createdAt: number
  count: number
  members: string[]
}

export interface SearchParams {
  game?: string
  tags?: string
}

export async function searchRooms(params: SearchParams = {}): Promise<RoomResponse[]> {
  const query = new URLSearchParams()
  if (params.game) query.set('game', params.game)
  if (params.tags) query.set('tags', params.tags)
  const qs = query.toString()
  const res = await fetch(`/api/search${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`)
  }
  return res.json()
}
