import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { RoomResponse } from '../lib/api'
import type { RoomEvent } from './roomStore'

const mocks = vi.hoisted(() => {
  const forceDisconnectVoice = vi.fn()
  const handleVoiceMembers = vi.fn()
  const voiceStore = { getState: () => ({ forceDisconnectVoice, handleVoiceMembers }) }
  return { forceDisconnectVoice, handleVoiceMembers, voiceStore }
})

vi.mock('../lib/stomp', () => ({
  ensureStompConnected: vi.fn(),
  subscribeTopic: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  getRoomMessages: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/audioPing', () => ({
  playMentionPing: vi.fn(),
}))

vi.mock('./voiceStore', () => ({
  useVoiceStore: mocks.voiceStore,
}))

import { useRoomStore } from './roomStore'
import { subscribeTopic } from '../lib/stomp'

const roomFixture: RoomResponse = {
  id: 'room-def05',
  title: 'DEF-05 방',
  game: 'Talklite',
  tags: ['def05'],
  capacity: 5,
  scope: 'PUBLIC',
  type: 'TEMPORARY',
  host: 'host-def05',
  createdAt: 1,
  count: 2,
  members: ['host-def05', 'me-def05'],
}

function kickedEvent(targetUser: string): RoomEvent {
  return {
    type: 'MEMBER_KICKED',
    roomId: roomFixture.id,
    actor: 'host-def05',
    targetUser,
    memberCount: 1,
    capacity: roomFixture.capacity,
    host: 'host-def05',
    voiceCount: 0,
    timestamp: Date.now(),
  }
}

describe('roomStore DEF-05 — MEMBER_KICKED 처리', () => {
  const unsubscribeEvents = vi.fn()
  const unsubscribeChat = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('talklite_uid', 'me-def05')
    vi.mocked(subscribeTopic).mockReset()
    vi.mocked(subscribeTopic)
      .mockReturnValueOnce({ unsubscribe: unsubscribeEvents })
      .mockReturnValueOnce({ unsubscribe: unsubscribeChat })
    mocks.forceDisconnectVoice.mockReset()
    mocks.handleVoiceMembers.mockReset()
    unsubscribeEvents.mockReset()
    unsubscribeChat.mockReset()
    useRoomStore.setState({
      currentRoom: roomFixture,
      messages: [],
      voiceMembers: ['me-def05'],
      subscriptions: [],
    })
  })

  afterEach(() => {
    useRoomStore.setState({ currentRoom: null, messages: [], voiceMembers: [], subscriptions: [] })
    localStorage.clear()
  })

  it('현재 사용자를 대상으로 한 강퇴는 음성 연결 해제, 토픽 구독 해제, kicked 콜백/이벤트를 수행한다', async () => {
    await useRoomStore.getState().connectRoomStomp(roomFixture.id)
    expect(useRoomStore.getState().subscriptions).toHaveLength(2)

    const onKicked = vi.fn()
    window.addEventListener('talklite:kicked', onKicked)

    useRoomStore.getState().updateRoomEvent(kickedEvent('me-def05'))

    expect(mocks.forceDisconnectVoice).toHaveBeenCalledTimes(1)
    expect(unsubscribeEvents).toHaveBeenCalledTimes(1)
    expect(unsubscribeChat).toHaveBeenCalledTimes(1)
    expect(useRoomStore.getState().currentRoom).toBeNull()
    expect(useRoomStore.getState().messages).toEqual([])
    expect(useRoomStore.getState().voiceMembers).toEqual([])
    expect(useRoomStore.getState().subscriptions).toEqual([])
    expect(onKicked).toHaveBeenCalledTimes(1)

    window.removeEventListener('talklite:kicked', onKicked)
  })

  it('다른 사용자를 대상으로 한 강퇴는 현재 사용자의 음성/구독 상태를 건드리지 않는다', async () => {
    await useRoomStore.getState().connectRoomStomp(roomFixture.id)
    const onKicked = vi.fn()
    window.addEventListener('talklite:kicked', onKicked)

    useRoomStore.getState().updateRoomEvent(kickedEvent('other-user'))

    expect(mocks.forceDisconnectVoice).not.toHaveBeenCalled()
    expect(unsubscribeEvents).not.toHaveBeenCalled()
    expect(useRoomStore.getState().currentRoom).not.toBeNull()
    expect(useRoomStore.getState().subscriptions).toHaveLength(2)
    expect(onKicked).not.toHaveBeenCalled()

    window.removeEventListener('talklite:kicked', onKicked)
  })
})
