import { recoverSession } from './stomp'

export type RoomScope = 'PUBLIC' | 'PRIVATE'
export type RoomType = 'TEMPORARY' | 'PERMANENT'

export interface RoomResponse {
  id: string
  title?: string | null
  game: string
  tags: string[]
  capacity: number
  scope: RoomScope
  type: RoomType
  host: string
  createdAt: number
  count: number
  voiceCount?: number
  members: string[]
  offlineMembers?: string[]
}

export type SearchField = 'all' | 'game' | 'title' | 'tag'

export interface SearchParams {
  game?: string
  tags?: string
  q?: string
  field?: SearchField
  sort?: 'latest' | 'title' | 'members'
  order?: 'asc' | 'desc'
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
      if (code === 'room_capacity_conflict') {
        throw new ApiError(409, code, '정원이 현재 인원보다 작아 변경할 수 없습니다')
      }
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

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('talklite_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * 인증 헤더가 포함된 모든 API 호출의 공통 fetch.
 * 401이면 STOMP와 동일한 세션 복구를 수행하고 새 토큰으로 1회만 재시도한다.
 */
async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = () =>
    fetch(input, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...getAuthHeaders() } })

  const res = await send()
  if (res.status !== 401) return res
  try {
    await recoverSession()
  } catch {
    // 세션 복구 자체가 실패하면 기존과 동일하게 401 응답을 그대로 돌려준다
    return res
  }
  return send()
}

export async function joinRoom(roomId: string, user: string): Promise<RoomResponse> {
  const res = await authFetch(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function leaveRoom(roomId: string, user: string): Promise<RoomResponse> {
  const res = await authFetch(`/api/rooms/${roomId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function kickUser(roomId: string, actor: string, targetUser: string, type: KickType): Promise<RoomResponse> {
  const res = await authFetch(`/api/rooms/${roomId}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, targetUser, type } satisfies KickRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export interface CreateRoomInput {
  title?: string
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
  secret?: string | null
}

export interface InviteCodeResponse {
  code: string
  roomId: string
  expiresInSeconds: number
}

export async function createSession(user?: string, secret?: string): Promise<SessionResponse> {
  const body: { user?: string; secret?: string } = {}
  if (user) body.user = user
  if (secret) body.secret = secret
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function createRoom(input: CreateRoomInput): Promise<RoomResponse> {
  const res = await authFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function getInviteCode(roomId: string, actor: string): Promise<InviteCodeResponse> {
  const res = await authFetch(`/api/rooms/${roomId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor }),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function getRoomInviteCode(roomId: string): Promise<InviteCodeResponse> {
  const res = await authFetch(`/api/rooms/${roomId}/invite`)
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function joinWithInviteCode(code: string, user: string): Promise<RoomResponse> {
  const res = await authFetch(`/api/invite/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user } satisfies JoinRequest),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function getRoom(roomId: string): Promise<RoomResponse> {
  const res = await authFetch(`/api/rooms/${roomId}`)
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function searchRooms(params: SearchParams = {}): Promise<RoomResponse[]> {
  const query = new URLSearchParams()
  if (params.game) query.set('game', params.game)
  if (params.tags) query.set('tags', params.tags)
  if (params.q) {
    query.set('q', params.q)
    if (params.field) query.set('field', params.field)
  }
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  const qs = query.toString()
  const res = await authFetch(`/api/search${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`)
  }
  return res.json()
}

export async function deleteRoom(roomId: string, actor: string): Promise<void> {
  const res = await authFetch(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor }),
  })
  if (!res.ok) return parseError(res)
}

export interface UpdateRoomInput {
  title?: string
  game?: string
  tags?: string[]
  capacity?: number
}

export async function updateRoom(roomId: string, data: UpdateRoomInput): Promise<RoomResponse> {
  const res = await authFetch(`/api/rooms/${roomId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

export interface ApiChatMessage {
  messageId: string
  clientRequestId?: string | null
  roomId: string
  sender: string
  senderName: string
  content: string
  timestamp: number
  type: string
  mediaUrl?: string | null
  mentions?: string[] | null
}

export async function getRoomMessages(roomId: string, limit = 50): Promise<ApiChatMessage[]> {
  const res = await authFetch(`/api/rooms/${roomId}/messages?limit=${limit}`)
  if (!res.ok) return parseError(res)
  return res.json()
}

export async function uploadRoomImage(roomId: string, blob: Blob, filename = 'paste.webp'): Promise<{ url: string; mediaUrl: string }> {
  const form = new FormData()
  form.append('file', blob, filename)
  // fetch will set multipart boundary automatically — do not set Content-Type
  const res = await authFetch(`/api/rooms/${roomId}/images`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) return parseError(res)
  return res.json()
}

