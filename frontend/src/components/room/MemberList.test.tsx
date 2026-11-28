import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { RoomResponse } from '../../lib/api'

/**
 * T-H4: 유예 시간(연결 끊김) 중인 참여자는 흐리게 표시되고
 * 서브 상태 문구가 '연결 끊김' 으로 노출되어야 한다.
 */

const voiceState = {
  speakingUsers: {} as Record<string, boolean>,
  peerVolumes: {} as Record<string, number>,
  peerMutes: {} as Record<string, boolean>,
  isInVoice: false,
  voiceMembers: [] as string[],
  setPeerVolume: vi.fn(),
  togglePeerMute: vi.fn(),
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
}

vi.mock('../../store/voiceStore', () => ({
  useVoiceStore: (selector: (state: typeof voiceState) => unknown) => selector(voiceState),
  getUid: () => 'me-offline',
}))

vi.mock('../../lib/api', () => ({
  kickUser: vi.fn(),
}))

vi.mock('../../lib/stomp', () => ({
  ensureStompConnected: vi.fn(),
  subscribeTopic: vi.fn(),
}))

vi.mock('../../lib/audioPing', () => ({
  playMentionPing: vi.fn(),
}))

import { MemberList } from './MemberList'
import { useRoomStore } from '../../store/roomStore'

const roomFixture: RoomResponse = {
  id: 'room-offline',
  title: 'OFFLINE 방',
  game: 'Talklite',
  tags: ['offline'],
  capacity: 5,
  scope: 'PUBLIC',
  type: 'TEMPORARY',
  host: 'host-offline',
  createdAt: 1,
  count: 2,
  members: ['host-offline', 'me-offline'],
}

function subStatusOf(container: HTMLElement, member: string): string {
  const card = container.querySelector(`[data-peer-card="${member}"]`) as HTMLElement
  return (card.querySelector('.member-sub-status') as HTMLElement).textContent ?? ''
}

describe('MemberList — 유예 중 참여자 표시', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('talklite_uid', 'me-offline')
    useRoomStore.setState({
      currentRoom: roomFixture,
      messages: [],
      voiceMembers: [],
      offlineMembers: ['host-offline'],
      subscriptions: [],
    })
  })

  afterEach(() => {
    cleanup()
    useRoomStore.setState({ currentRoom: null, messages: [], voiceMembers: [], offlineMembers: [], subscriptions: [] })
    localStorage.clear()
  })

  it('offlineMembers 에 포함된 참여자는 흐리게 표시되고 서브 상태가 연결 끊김이다', () => {
    const { container } = render(<MemberList roomId={roomFixture.id} />)

    expect(subStatusOf(container, 'host-offline')).toBe('연결 끊김')
    expect(container.querySelector('[data-peer-card="host-offline"]')?.className).toContain('member-offline')

    // 온라인 참여자는 기존 음성 상태 문구 유지
    expect(subStatusOf(container, 'me-offline')).toBe('음성 미연결')
    expect(container.querySelector('[data-peer-card="me-offline"]')?.className).not.toContain('member-offline')
  })

  it('offlineMembers 가 비면 모든 참여자가 기존 음성 상태 문구로 표시된다', () => {
    useRoomStore.setState({ offlineMembers: [] })
    const { container } = render(<MemberList roomId={roomFixture.id} />)

    expect(subStatusOf(container, 'host-offline')).toBe('음성 미연결')
    expect(container.querySelector('[data-peer-card="host-offline"]')?.className).not.toContain('member-offline')
  })
})
