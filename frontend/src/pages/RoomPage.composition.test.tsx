import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

/**
 * DEF-09: 한글 IME 조합 중 Enter 입력은 메시지를 전송하지 않고,
 * 조합이 끝난 뒤의 Enter 는 정확히 한 번만 전송해야 한다.
 */

vi.mock('../lib/api', () => ({
  joinRoom: vi.fn(),
  getRoom: vi.fn(),
  deleteRoom: vi.fn(),
  uploadRoomImage: vi.fn(),
  getRoomInviteCode: vi.fn(async () => ({ code: 'DEF009' })),
}))

vi.mock('../lib/stomp', () => ({
  ensureStompConnected: vi.fn(),
  subscribeTopic: vi.fn(() => ({ unsubscribe: vi.fn() })),
  getStompClient: vi.fn(),
  setSessionToken: vi.fn(),
  recoverSession: vi.fn(),
}))

vi.mock('../lib/audioPing', () => ({
  playMentionPing: vi.fn(),
  playVoiceJoinSound: vi.fn(),
  playVoiceLeaveSound: vi.fn(),
}))

vi.mock('../store/voiceStore', () => ({
  useVoiceStore: {
    getState: () => ({ connectRoomVoice: vi.fn(async () => {}) }),
  },
}))

vi.mock('../components/room/ChatLog', () => ({ ChatLog: () => null }))
vi.mock('../components/room/MemberList', () => ({ MemberList: () => null }))
vi.mock('../components/room/InviteModal', () => ({ InviteModal: () => null }))
vi.mock('../components/room/EditRoomModal', () => ({ EditRoomModal: () => null }))
vi.mock('../components/voice/VoiceBar', () => ({ VoiceBar: () => null }))

import { RoomPage } from './RoomPage'
import { useRoomStore } from '../store/roomStore'
import type { RoomResponse } from '../lib/api'

const roomFixture: RoomResponse = {
  id: 'room-def09',
  title: 'DEF-09 방',
  game: 'Talklite',
  tags: ['def09'],
  capacity: 5,
  scope: 'PUBLIC',
  type: 'TEMPORARY',
  host: 'host-def09',
  createdAt: 1,
  count: 2,
  members: ['host-def09', 'me-def09'],
}

const inputPlaceholder = '메시지를 입력하세요 (@멘션, Ctrl+V 이미지 붙여넣기 지원)...'

describe('RoomPage DEF-09 — IME 조합 중 Enter 전송 차단', () => {
  let sendChat: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('talklite_uid', 'me-def09')
    sendChat = vi.fn()
    useRoomStore.setState({
      currentRoom: roomFixture,
      messages: [],
      sendChat: sendChat as unknown as (content: string) => Promise<void>,
    })
  })

  afterEach(() => {
    cleanup()
    useRoomStore.setState({ currentRoom: null, messages: [] })
    localStorage.clear()
  })

  it('조합 중 Enter 는 전송하지 않고, 조합 종료 후 Enter 는 한 번만 전송한다', async () => {
    const { container } = render(<RoomPage roomId={roomFixture.id} onExit={vi.fn()} onKicked={vi.fn()} />)
    const input = screen.getByPlaceholderText(inputPlaceholder) as HTMLInputElement
    const form = container.querySelector('form.chat-input-row') as HTMLFormElement

    // 한글 조합 시작 → 값 갱신 → Enter (조합 확정 키가 폼 제출로 이어지는 상황)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.submit(form)

    expect(sendChat).not.toHaveBeenCalled()

    // 조합 종료 후 Enter → 정상 전송 (1회)
    fireEvent.compositionEnd(input)
    await waitFor(() => expect(input.value).toBe('안녕'))
    fireEvent.submit(form)

    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1))
    expect(sendChat).toHaveBeenCalledWith('안녕')
  })

  it('nativeEvent.isComposing 이 true 인 Enter(keyCode 229 포함)도 전송하지 않는다', async () => {
    render(<RoomPage roomId={roomFixture.id} onExit={vi.fn()} onKicked={vi.fn()} />)
    const input = screen.getByPlaceholderText(inputPlaceholder) as HTMLInputElement

    fireEvent.change(input, { target: { value: '조합중' } })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }))

    expect(sendChat).not.toHaveBeenCalled()
  })
})
