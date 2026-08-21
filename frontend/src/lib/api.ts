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

export type KickType = 'TEMPORARY' | 'PERMANENT'

export interface JoinRequest {
  user: string
}

export interface KickRequest {
  actor: string
  targetUser: string
  type: KickType
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function parseError(res: Response): Promise<never> {
  let code = ''
  try {
    const body = await res.json()
    code = body?.error ?? ''
  } catch {
    // body 없음
  }
  switch (res.status) {
    case 409:
      throw new ApiError(409, code || 'room_full', '방이 가득 찼습니다')
    case 403:
      throw new ApiError(403, code || 'forbidden', code === 'user_banned' ? '강퇴/차단된 사용자입니다' : '권한이 없습니다')
    case 404:
      throw new ApiError(404, code || 'room_not_found', '방을 찾을 수 없습니다')
    case 400:
      throw new ApiError(400, code || 'invalid_request', '잘못된 요청입니다')
    default:
      throw new ApiError(res.status, code, `요청 실패: ${res.status}`)
  }
}

export async function joinRoom(roomId: string, user: string): Promise<RoomResponse> {
  const res = await fetch(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function leaveRoom(roomId: string, user: string): Promise<RoomResponse> {
  const res = await fetch(`/api/rooms/${roomId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function kickUser(roomId: string, actor: string, targetUser: string, type: KickType): Promise<RoomResponse> {
  const res = await fetch(`/api/rooms/${roomId}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, targetUser, type } satisfies KickRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export interface CreateRoomInput {
  game: string
  tags: string[]
  capacity: number
  scope: RoomScope
  type: RoomType
  host: string
}

export interface SessionResponse {
  token: string
  user: string
  expiresIn: number
}

export interface InviteCodeResponse {
  code: string
  roomId: string
  expiresInSeconds: number
}

export async function createSession(user?: string): Promise<SessionResponse> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user ? { user } : {}),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function createRoom(input: CreateRoomInput): Promise<RoomResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function getInviteCode(roomId: string, actor: string): Promise<InviteCodeResponse> {
  const res = await fetch(`/api/rooms/${roomId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor }),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function joinWithInviteCode(code: string, user: string): Promise<RoomResponse> {
  const res = await fetch(`/api/invite/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function getRoom(roomId: string): Promise<RoomResponse> {
  const res = await fetch(`/api/rooms/${roomId}`)
  if (!res.ok) return parseError(res)
  return res.json()
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
