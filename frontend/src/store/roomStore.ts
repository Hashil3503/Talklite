import { create } from 'zustand'
import { type RoomResponse, type ApiChatMessage, getRoomMessages } from '../lib/api'
import { ensureStompConnected } from '../lib/stomp'
import { useVoiceStore } from './voiceStore'
import { playMentionPing } from '../lib/audioPing'

export interface ChatMessage {
  messageId: string
  clientRequestId?: string
  roomId: string
  sender: string
  senderName: string
  content: string
  sentAt: number
  type: string
  mediaUrl?: string | null
  mentions?: string[]
  status?: 'pending' | 'confirmed' | 'failed'
}

export interface RoomEvent {
  type: string
  roomId: string
  actor: string
  targetUser?: string
  memberCount: number
  capacity: number
  host: string
  voiceCount: number
  voiceMembers?: string[]
  timestamp: number
  extra?: Record<string, any>
  data?: Record<string, any>
  title?: string
  game?: string
  tags?: string[]
}

type RawChatMessage = Omit<ChatMessage, 'sentAt'> & { sentAt?: number; timestamp?: number }

function normalizeMessage(raw: RawChatMessage): ChatMessage {
  return {
    ...raw,
    sentAt: raw.sentAt ?? raw.timestamp ?? Date.now(),
    mentions: raw.mentions ?? [],
    mediaUrl: raw.mediaUrl ?? null,
    type: raw.type ?? 'TALK',
  } as ChatMessage
}

interface RoomState {
  currentRoom: RoomResponse | null
  messages: ChatMessage[]
  voiceMembers: string[]
  subscriptions: { unsubscribe: () => void }[]

  setCurrentRoom: (room: RoomResponse | null) => void
  loadRecentMessages: (roomId: string) => Promise<void>
  addMessage: (msg: ChatMessage) => void
  sendChat: (content: string) => Promise<void>
  sendImageChat: (mediaUrl: string, caption?: string) => Promise<void>
  connectRoomStomp: (roomId: string) => Promise<void>
  disconnectRoomStomp: () => void
  updateRoomEvent: (event: RoomEvent) => void
}

export const useRoomStore = create<RoomState>((set, get) => ({
  currentRoom: null,
  messages: [],
  voiceMembers: [],
  subscriptions: [],

  setCurrentRoom: (room) => {
    set({ currentRoom: room, messages: [], voiceMembers: [] })
    if (room) {
      get().connectRoomStomp(room.id)
      void get().loadRecentMessages(room.id)
    } else {
      get().disconnectRoomStomp()
    }
  },

  loadRecentMessages: async (roomId: string) => {
    try {
      const history: ApiChatMessage[] = await getRoomMessages(roomId, 50)
      if (!history || history.length === 0) return
      const normalized: ChatMessage[] = history.map((h) =>
        normalizeMessage({
          messageId: h.messageId,
          clientRequestId: h.clientRequestId ?? undefined,
          roomId: h.roomId,
          sender: h.sender,
          senderName: h.senderName,
          content: h.content,
          timestamp: h.timestamp,
          type: h.type,
          mediaUrl: h.mediaUrl ?? null,
          mentions: h.mentions ?? [],
        } as unknown as RawChatMessage)
      )
      set((state) => {
        if (state.currentRoom?.id !== roomId) return state
        const existingIds = new Set(state.messages.map((m) => m.messageId))
        const fresh = normalized.filter((m) => !existingIds.has(m.messageId))
        if (fresh.length === 0) return state
        const merged = [...state.messages, ...fresh].sort((a, b) => a.sentAt - b.sentAt)
        return { messages: merged }
      })
    } catch (err) {
      console.warn('Failed to load recent room messages:', err)
    }
  },

  addMessage: (msg) => {
    const incoming = normalizeMessage(msg as RawChatMessage)
    // 멘션 핑: 내가 멘션됐고 발신자가 내가 아니면 사운드 재생 (500ms 디바운스는 audioPing 내부)
    try {
      const myUid = localStorage.getItem('talklite_uid') || ''
      if (
        myUid &&
        incoming.sender !== myUid &&
        Array.isArray(incoming.mentions) &&
        incoming.mentions.includes(myUid)
      ) {
        playMentionPing()
      }
    } catch {}
    set((state) => {
      if (incoming.clientRequestId) {
        const index = state.messages.findIndex(
          (m) => m.clientRequestId === incoming.clientRequestId || m.messageId === incoming.messageId
        )
        if (index >= 0) {
          const updated = [...state.messages]
          updated[index] = { ...incoming, status: 'confirmed' }
          return { messages: updated }
        }
      } else if (state.messages.some((m) => m.messageId === incoming.messageId)) {
        return state
      }
      return { messages: [...state.messages, { ...incoming, status: 'confirmed' }] }
    })
  },

  sendChat: async (content) => {
    const { currentRoom } = get()
    if (!currentRoom || !content.trim()) return

    const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const uid = localStorage.getItem('talklite_uid') || 'anonymous'

    const tempMsg: ChatMessage = {
      messageId: `temp-${clientRequestId}`,
      clientRequestId,
      roomId: currentRoom.id,
      sender: uid,
      senderName: uid,
      content: content.trim(),
      sentAt: Date.now(),
      type: 'TALK',
      mediaUrl: null,
      mentions: [],
      status: 'pending',
    }

    set((state) => ({ messages: [...state.messages, tempMsg] }))

    try {
      const client = await ensureStompConnected()
      client.publish({
        destination: `/app/room/${currentRoom.id}/chat`,
        body: JSON.stringify({
          clientRequestId,
          content: content.trim(),
          type: 'TALK',
        }),
      })

      setTimeout(() => {
        set((state) => {
          const msg = state.messages.find((m) => m.clientRequestId === clientRequestId)
          if (msg && msg.status === 'pending') {
            const updated = state.messages.map((m) =>
              m.clientRequestId === clientRequestId ? { ...m, status: 'failed' as const } : m
            )
            return { messages: updated }
          }
          return state
        })
      }, 3000)
    } catch {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.clientRequestId === clientRequestId ? { ...m, status: 'failed' as const } : m
        ),
      }))
    }
  },

  sendImageChat: async (mediaUrl, caption) => {
    const { currentRoom } = get()
    if (!currentRoom || !mediaUrl) return
    const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const uid = localStorage.getItem('talklite_uid') || 'anonymous'
    const text = caption?.trim() ?? ''

    const tempMsg: ChatMessage = {
      messageId: `temp-${clientRequestId}`,
      clientRequestId,
      roomId: currentRoom.id,
      sender: uid,
      senderName: uid,
      content: text,
      sentAt: Date.now(),
      type: 'IMAGE',
      mediaUrl,
      mentions: [],
      status: 'pending',
    }
    set((state) => ({ messages: [...state.messages, tempMsg] }))

    try {
      const client = await ensureStompConnected()
      client.publish({
        destination: `/app/room/${currentRoom.id}/chat`,
        body: JSON.stringify({
          clientRequestId,
          content: text,
          type: 'IMAGE',
          mediaUrl,
        }),
      })
      setTimeout(() => {
        set((state) => {
          const msg = state.messages.find((m) => m.clientRequestId === clientRequestId)
          if (msg && msg.status === 'pending') {
            const updated = state.messages.map((m) =>
              m.clientRequestId === clientRequestId ? { ...m, status: 'failed' as const } : m
            )
            return { messages: updated }
          }
          return state
        })
      }, 3000)
    } catch {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.clientRequestId === clientRequestId ? { ...m, status: 'failed' as const } : m
        ),
      }))
    }
  },

  connectRoomStomp: async (roomId) => {
    get().disconnectRoomStomp()
    const client = await ensureStompConnected()

    const subEvents = client.subscribe(`/topic/room/${roomId}`, (message) => {
      try {
        const event: RoomEvent = JSON.parse(message.body)
        get().updateRoomEvent(event)
      } catch (err) {
        console.error('Failed to parse room event:', err)
      }
    })

    const subChat = client.subscribe(`/topic/room/${roomId}/chat`, (message) => {
      try {
        const raw: RawChatMessage = JSON.parse(message.body)
        get().addMessage(raw as unknown as ChatMessage)
      } catch (err) {
        console.error('Failed to parse chat message:', err)
      }
    })

    set({ subscriptions: [subEvents, subChat] })
  },

  disconnectRoomStomp: () => {
    const { subscriptions } = get()
    subscriptions.forEach((sub) => {
      try {
        sub.unsubscribe()
      } catch {}
    })
    set({ subscriptions: [] })
  },

  updateRoomEvent: (event) => {
    const { currentRoom } = get()
    if (!currentRoom || currentRoom.id !== event.roomId) return

    if (event.type === 'ROOM_DESTROYED') {
      useVoiceStore.getState().forceDisconnectVoice()
      get().disconnectRoomStomp()
      set({ currentRoom: null, messages: [], voiceMembers: [] })
      return
    }

    const currentUserId = localStorage.getItem('talklite_uid') || 'anonymous'
    if (event.type === 'MEMBER_KICKED' && event.targetUser === currentUserId) {
      useVoiceStore.getState().forceDisconnectVoice()
      get().disconnectRoomStomp()
      set({ currentRoom: null, messages: [], voiceMembers: [] })
      window.dispatchEvent(new CustomEvent('talklite:kicked', { detail: event }))
      return
    }

    if (event.type === 'MEMBER_JOIN' && event.actor) {
      const members = Array.from(new Set([...currentRoom.members, event.actor])).sort()
      set({
        currentRoom: {
          ...currentRoom,
          count: event.memberCount,
          host: event.host,
          members,
        },
      })
    } else if (event.type === 'MEMBER_LEAVE' && event.actor) {
      const members = currentRoom.members.filter((m) => m !== event.actor).sort()
      set({
        currentRoom: {
          ...currentRoom,
          count: event.memberCount,
          host: event.host,
          members,
        },
      })
    } else if (event.type === 'HOST_MIGRATED' || event.type === 'MEMBER_KICKED') {
      set({
        currentRoom: {
          ...currentRoom,
          count: event.memberCount,
          host: event.host,
        },
      })
    } else if (event.type === 'VOICE_STATUS_CHANGED') {
      const members = Array.isArray(event.voiceMembers) ? event.voiceMembers : []
      set({ voiceMembers: members })
      useVoiceStore.getState().handleVoiceMembers(members)
    } else if (event.type === 'ROOM_UPDATED') {
      const data = (event.data ?? event.extra ?? {}) as Record<string, any>
      const title = (data.title ?? event.title) as string | undefined
      const game = (data.game ?? event.game) as string | undefined
      const tags = (data.tags ?? event.tags) as string[] | undefined
      const capacity = (data.capacity ?? event.capacity) as number | undefined
      set({
        currentRoom: {
          ...currentRoom,
          title: title !== undefined ? title : currentRoom.title,
          game: game !== undefined ? game : currentRoom.game,
          tags: Array.isArray(tags) ? tags : currentRoom.tags,
          capacity: typeof capacity === 'number' ? capacity : currentRoom.capacity,
        },
      })
    }
  },
}))
