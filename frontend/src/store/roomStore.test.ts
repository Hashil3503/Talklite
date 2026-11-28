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

function roomEvent(type: string, actor: string, targetUser?: string): RoomEvent {
  return {
    type,
    roomId: roomFixture.id,
    actor,
    targetUser,
    memberCount: roomFixture.count,
    capacity: roomFixture.capacity,
    host: roomFixture.host,
    voiceCount: 0,
    timestamp: Date.now(),
  }
}

describe('roomStore — offlineMembers (MEMBER_OFFLINE / MEMBER_ONLINE)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('talklite_uid', 'me-def05')
    useRoomStore.setState({
      currentRoom: roomFixture,
      messages: [],
      voiceMembers: [],
      offlineMembers: ['host-def05'],
      subscriptions: [],
    })
  })

  afterEach(() => {
    useRoomStore.setState({ currentRoom: null, messages: [], voiceMembers: [], offlineMembers: [], subscriptions: [] })
    localStorage.clear()
  })

  it('setCurrentRoom 은 응답의 offlineMembers 로 초기화하고, 없으면 빈 배열이다', () => {
    useRoomStore.getState().setCurrentRoom({ ...roomFixture, offlineMembers: ['host-def05'] })
    expect(useRoomStore.getState().offlineMembers).toEqual(['host-def05'])

    useRoomStore.getState().setCurrentRoom({ ...roomFixture })
    expect(useRoomStore.getState().offlineMembers).toEqual([])

    useRoomStore.getState().setCurrentRoom(null)
    expect(useRoomStore.getState().offlineMembers).toEqual([])
  })

  it('MEMBER_OFFLINE 은 actor 를, MEMBER_ONLINE 은 actor 를 제거한다', () => {
    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_OFFLINE', 'me-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual(['host-def05', 'me-def05'])

    // 중복 OFFLINE 은 한 번만 반영
    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_OFFLINE', 'me-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual(['host-def05', 'me-def05'])

    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_ONLINE', 'me-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual(['host-def05'])
  })

  it('MEMBER_LEAVE 는 actor 를, MEMBER_KICKED 는 targetUser 를 offlineMembers 에서 제거한다', () => {
    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_LEAVE', 'host-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual([])

    useRoomStore.setState({ offlineMembers: ['host-def05', 'other-def05'] })
    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_KICKED', 'host-def05', 'other-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual(['host-def05'])
  })

  it('다른 사람이 강퇴되면 멤버 목록에서 바로 빠진다', () => {
    useRoomStore.setState({ currentRoom: { ...roomFixture, members: ['host-def05', 'me-def05', 'other-def05'] } })
    useRoomStore.getState().updateRoomEvent(roomEvent('MEMBER_KICKED', 'host-def05', 'other-def05'))
    expect(useRoomStore.getState().currentRoom?.members).toEqual(['host-def05', 'me-def05'])
  })

  it('방 파괴/강퇴로 방을 떠나면 offlineMembers 도 초기화된다', () => {
    useRoomStore.getState().updateRoomEvent(roomEvent('ROOM_DESTROYED', 'host-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual([])

    useRoomStore.setState({ currentRoom: roomFixture, offlineMembers: ['host-def05'] })
    useRoomStore.getState().updateRoomEvent(kickedEvent('me-def05'))
    expect(useRoomStore.getState().offlineMembers).toEqual([])
  })
})
