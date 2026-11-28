import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'

/**
 * DEF-07: 원격 오디오 재생(play)이 차단되면 자동재생 차단 배너가 노출되고,
 * 배너 클릭 시 AudioContext resume(unlock)이 호출되어야 한다.
 */

const stompMock = vi.hoisted(() => ({
  publish: vi.fn(),
}))

vi.mock('../../lib/stomp', () => ({
  ensureStompConnected: vi.fn(async () => stompMock),
  subscribeTopic: vi.fn(() => ({ unsubscribe: vi.fn() })),
  getStompClient: vi.fn(),
  setSessionToken: vi.fn(),
  recoverSession: vi.fn(),
}))

function fakeStream(): MediaStream {
  const track = {
    enabled: true,
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'mic-1' }),
  }
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static resumeCalls = 0
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = {} as AudioDestinationNode

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createGain() {
    return {
      gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  createMediaStreamDestination() {
    return { stream: fakeStream(), connect: vi.fn(), disconnect: vi.fn() }
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }

  // 브라우저 자동재생 정책: 제스처 없이는 resume() 후에도 running 으로 전이하지 않는다
  async resume() {
    FakeAudioContext.resumeCalls++
    this.state = 'suspended'
  }

  async close() {
    this.state = 'closed'
  }
}

// RNNoise worklet 모듈은 로드 시 AudioWorkletNode 를 참조하므로 jsdom 에서 불러올 수 없다
vi.mock('../../lib/noise/denoiseEngine', () => ({
  createDenoiseNode: vi.fn(async () => null),
  disposeDenoiseNode: vi.fn(),
}))

const webrtcMock = vi.hoisted(() => ({
  captured: null as null | { onRemoteStream: (peerId: string, stream: MediaStream) => void },
  destroy: vi.fn(),
  setLocalStream: vi.fn(),
}))

vi.mock('../../lib/webrtc', () => ({
  WebRtcManager: class {
    constructor(opts: { onRemoteStream: (peerId: string, stream: MediaStream) => void }) {
      webrtcMock.captured = opts
    }
    async init() {}
    get peerIds(): string[] {
      return []
    }
    hasPeer() {
      return false
    }
    addPeer() {}
    disconnectPeer() {}
    destroy() {
      webrtcMock.destroy()
    }
    setLocalStream() {
      webrtcMock.setLocalStream()
    }
  },
}))

import { useVoiceStore } from '../../store/voiceStore'
import { VoiceBar } from './VoiceBar'

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DEF-07 — 원격 오디오 자동재생 차단 배너', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('talklite_uid', 'me-def07')
    FakeAudioContext.instances = []
    FakeAudioContext.resumeCalls = 0
    webrtcMock.captured = null
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => fakeStream()),
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    // 원격 오디오 요소의 play() 는 자동재생 차단으로 거부된다
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      Object.assign(new Error('play() blocked'), { name: 'NotAllowedError' })
    )
    useVoiceStore.setState({
      isInVoice: false,
      isAudioAutoplayBlocked: false,
      voiceMembers: [],
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useVoiceStore.getState().leaveVoice(true)
  })

  it('원격 오디오 play() 가 차단되면 배너가 노출되고, 클릭 시 resume(unlock)을 호출한다', async () => {
    await act(async () => {
      await useVoiceStore.getState().joinVoice('room-def07')
    })
    await flush()

    expect(webrtcMock.captured).not.toBeNull()

    // joinVoice 자체의 resume 실패로 이미 배너가 떠 있을 수 있으므로 초기화 후 원격 오디오 경로만 검증
    useVoiceStore.setState({ isAudioAutoplayBlocked: false })
    const resumeCallsBefore = FakeAudioContext.resumeCalls

    // 원격 피어 스트림 도착 → attachRemote(play 시도) → play() 거부 + suspended 컨텍스트
    await act(async () => {
      webrtcMock.captured!.onRemoteStream('peer-1', fakeStream())
      await Promise.resolve()
    })
    await flush()

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(useVoiceStore.getState().isAudioAutoplayBlocked).toBe(true)
    expect(FakeAudioContext.resumeCalls).toBeGreaterThan(resumeCallsBefore)

    render(<VoiceBar />)
    const banner = screen.getByRole('button', { name: '🔊 오디오 켜기' })
    expect(banner).toBeTruthy()

    const resumeCallsBeforeClick = FakeAudioContext.resumeCalls
    await act(async () => {
      fireEvent.click(banner)
      await Promise.resolve()
    })
    await flush()

    // unlockAudio → engine.resume() 재시도 (브라우저가 여전히 거부하므로 배너는 유지)
    expect(FakeAudioContext.resumeCalls).toBeGreaterThan(resumeCallsBeforeClick)
    expect(useVoiceStore.getState().isAudioAutoplayBlocked).toBe(true)
  })
})
