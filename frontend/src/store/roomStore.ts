import { create } from 'zustand'
import { type RoomResponse } from '../lib/api'
import { ensureStompConnected } from '../lib/stomp'
import { useVoiceStore } from './voiceStore'

export interface ChatMessage {
  messageId: string
  clientRequestId?: string
  roomId: string
  sender: string
  senderName: string
  content: string
  sentAt: number
  type: string
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
}

interface RoomState {
  currentRoom: RoomResponse | null
  messages: ChatMessage[]
  voiceMembers: string[]
  subscriptions: { unsubscribe: () => void }[]

  setCurrentRoom: (room: RoomResponse | null) => void
  addMessage: (msg: ChatMessage) => void
  sendChat: (content: string) => Promise<void>
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
    } else {
      get().disconnectRoomStomp()
    }
  },

  addMessage: (msg) => {
    set((state) => {
      // clientRequestId가 있으면 기존 pending 메시지 confirmed로 교체
      if (msg.clientRequestId) {
        const index = state.messages.findIndex(
          (m) => m.clientRequestId === msg.clientRequestId || m.messageId === msg.messageId
        )
        if (index >= 0) {
          const updated = [...state.messages]
          updated[index] = { ...msg, status: 'confirmed' }
          return { messages: updated }
        }
      }
      return { messages: [...state.messages, { ...msg, status: 'confirmed' }] }
    })
  },

  sendChat: async (content) => {
    const { currentRoom } = get()
    if (!currentRoom || !content.trim()) return

    const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const uid = localStorage.getItem('talklite_uid') || 'anonymous'

    // 1. 낙관적 임시 렌더
    const tempMsg: ChatMessage = {
      messageId: `temp-${clientRequestId}`,
      clientRequestId,
      roomId: currentRoom.id,
      sender: uid,
      senderName: uid,
      content: content.trim(),
      sentAt: Date.now(),
      type: 'TALK',
      status: 'pending',
    }

    set((state) => ({ messages: [...state.messages, tempMsg] }))

    // 2. STOMP 전송
    try {
      const client = await ensureStompConnected()
      client.publish({
        destination: `/app/room/${currentRoom.id}/chat`,
        body: JSON.stringify({
          clientRequestId,
          content: content.trim(),
        }),
      })

      // 3초 타임아웃 검사
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
        const chatMsg: ChatMessage = JSON.parse(message.body)
        get().addMessage(chatMsg)
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
    }
  },
}))
