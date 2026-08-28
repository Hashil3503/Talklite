import { create } from 'zustand'
import type { Client } from '@stomp/stompjs'
import { ensureStompConnected } from '../lib/stomp'
import { WebRtcManager } from '../lib/webrtc'
import { AudioDetector } from '../lib/audioDetector'
import { VoiceAudioEngineImpl } from '../lib/voiceAudioEngine'

// ── 전역 리소스 (React 상태 아님)
let manager: WebRtcManager | null = null
let detector: AudioDetector | null = null
let rawMicStream: MediaStream | null = null
let speakerUnsub: { unsubscribe: () => void } | null = null
let stompClient: Client | null = null
let wasInVoice = false
let activeRoomId: string | null = null
let engine: VoiceAudioEngineImpl | null = null

// ── localStorage 키 & 디바운스
const LS_INPUT_GAIN = 'talklite_input_gain'
const LS_MASTER_VOLUME = 'talklite_master_volume'
const LS_USER_VOLUMES = 'talklite_user_volumes'

let inputGainTimer: ReturnType<typeof setTimeout> | null = null
let masterTimer: ReturnType<typeof setTimeout> | null = null
let peerVolumesTimer: ReturnType<typeof setTimeout> | null = null

function clampInputGain(v: number): number {
  return Math.min(2, Math.max(0, v))
}
function clampMasterVolume(v: number): number {
  return Math.min(1, Math.max(0, v))
}
function clampPeerVolume(v: number): number {
  return Math.min(2, Math.max(0, v))
}

function loadInputGain(): number {
  try {
    const raw = localStorage.getItem(LS_INPUT_GAIN)
    if (raw !== null) {
      const n = parseFloat(raw)
      if (Number.isFinite(n)) return clampInputGain(n)
    }
  } catch {
    /* ignore */
  }
  return 1
}
function loadMasterVolume(): number {
  try {
    const raw = localStorage.getItem(LS_MASTER_VOLUME)
    if (raw !== null) {
      const n = parseFloat(raw)
      if (Number.isFinite(n)) return clampMasterVolume(n)
    }
  } catch {
    /* ignore */
  }
  return 1
}
function loadPeerVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_USER_VOLUMES)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, number> = {}
        for (const [k, v] of Object.entries(parsed)) {
          const n = Number(v)
          if (Number.isFinite(n)) out[k] = clampPeerVolume(n)
        }
        return out
      }
    }
  } catch {
    /* ignore */
  }
  return {}
}

function debouncedSaveInputGain(value: number): void {
  if (inputGainTimer) clearTimeout(inputGainTimer)
  inputGainTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_INPUT_GAIN, String(value))
    } catch {
      /* ignore */
    }
  }, 300)
}
function debouncedSaveMasterVolume(value: number): void {
  if (masterTimer) clearTimeout(masterTimer)
  masterTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_MASTER_VOLUME, String(value))
    } catch {
      /* ignore */
    }
  }, 300)
}
function debouncedSavePeerVolumes(value: Record<string, number>): void {
  if (peerVolumesTimer) clearTimeout(peerVolumesTimer)
  peerVolumesTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_USER_VOLUMES, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }, 300)
}

function ensureEngine(): VoiceAudioEngineImpl {
  if (!engine) engine = new VoiceAudioEngineImpl()
  return engine
}

export function getUid(): string {
  return localStorage.getItem('talklite_uid') || 'anonymous'
}

function attachRemoteAudio(peerId: string, stream: MediaStream): void {
  const eng = ensureEngine()
  eng.attachRemote(peerId, stream)
  // 적용: 스마트 영구 기억 볼륨
  const state = useVoiceStore.getState()
  const savedVol = state.peerVolumes[peerId]
  if (savedVol !== undefined) {
    eng.setPeerVolume(peerId, savedVol)
  }
  if (state.peerMutes[peerId]) {
    eng.setPeerVolume(peerId, 0)
  }
  // Autoplay 차단 감지
  if (eng.getContextState() === 'suspended') {
    useVoiceStore.setState({ isAudioAutoplayBlocked: true })
  }
}

async function unlockAudio(): Promise<void> {
  const eng = engine
  if (!eng) {
    useVoiceStore.setState({ isAudioAutoplayBlocked: false })
    return
  }
  const ok = await eng.resume()
  useVoiceStore.setState({ isAudioAutoplayBlocked: !ok && eng.getContextState() === 'suspended' })
}

function removePeerAudio(peerId: string): void {
  engine?.removeRemote(peerId)
}

function cleanupVoiceResources(): void {
  manager?.destroy()
  manager = null
  detector?.stop()
  detector = null
  if (rawMicStream) {
    rawMicStream.getTracks().forEach((t) => t.stop())
    rawMicStream = null
  }
  engine?.destroy()
  engine = null
  wasInVoice = false
}

function startDetector(roomId: string): void {
  detector?.stop()
  detector = new AudioDetector({
    onTalkingChange: (talking) => {
      if (useVoiceStore.getState().isMuted) return
      stompClient?.publish({
        destination: `/app/room/${roomId}/speaker`,
        body: JSON.stringify({ talking }),
      })
    },
  })
  const streamForDetector = engine?.getProcessedStream() ?? rawMicStream ?? null
  if (streamForDetector) {
    detector.start(streamForDetector)
  }
}

interface VoiceState {
  isInVoice: boolean
  isMuted: boolean
  isDeafened: boolean
  voiceMembers: string[]
  speakingUsers: Record<string, boolean>
  audioDevices: MediaDeviceInfo[]
  error: string | null
  isAudioAutoplayBlocked: boolean
  // Phase 8 volumes
  inputGain: number
  masterVolume: number
  peerVolumes: Record<string, number>
  peerMutes: Record<string, boolean>

  connectRoomVoice: (roomId: string) => Promise<void>
  disconnectRoomVoice: () => void
  forceDisconnectVoice: () => void
  joinVoice: (roomId: string) => Promise<void>
  leaveVoice: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  setDevice: (deviceId: string) => Promise<void>
  handleVoiceMembers: (members: string[]) => void
  unlockAudio: () => Promise<void>
  // Phase 8 setters
  setInputGain: (value: number) => void
  setMasterVolume: (value: number) => void
  setPeerVolume: (peerId: string, value: number) => void
  togglePeerMute: (peerId: string) => void
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isDeafened: false,
  voiceMembers: [],
  speakingUsers: {},
  audioDevices: [],
  error: null,
  isAudioAutoplayBlocked: false,
  inputGain: loadInputGain(),
  masterVolume: loadMasterVolume(),
  peerVolumes: loadPeerVolumes(),
  peerMutes: {},

  connectRoomVoice: async (roomId: string) => {
    speakerUnsub?.unsubscribe()
    speakerUnsub = null
    const client = await ensureStompConnected()
    stompClient = client
    speakerUnsub = client.subscribe(`/topic/room/${roomId}/speaker`, (message: { body: string }) => {
      try {
        const event: { speakerId: string; talking: boolean } = JSON.parse(message.body)
        useVoiceStore.setState((state) => ({
          speakingUsers: { ...state.speakingUsers, [event.speakerId]: !!event.talking },
        }))
      } catch {
        // 파싱 실패 무시
      }
    })
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      set({ audioDevices: devices.filter((d) => d.kind === 'audioinput') })
    } catch {
      set({ audioDevices: [] })
    }
  },

  disconnectRoomVoice: () => {
    speakerUnsub?.unsubscribe()
    speakerUnsub = null
    if (activeRoomId && useVoiceStore.getState().isInVoice) {
      stompClient?.publish({
        destination: `/app/room/${activeRoomId}/voice/end`,
        body: '{}',
      })
    }
    cleanupVoiceResources()
    activeRoomId = null
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {} })
  },

  forceDisconnectVoice: () => {
    speakerUnsub?.unsubscribe()
    speakerUnsub = null
    cleanupVoiceResources()
    activeRoomId = null
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {} })
  },

  joinVoice: async (roomId: string) => {
    if (useVoiceStore.getState().isInVoice) {
      if (activeRoomId !== roomId) {
        useVoiceStore.getState().leaveVoice()
      } else {
        return
      }
    }
    activeRoomId = roomId
    try {
      if (!manager) {
        manager = new WebRtcManager({
          roomId,
          userId: getUid(),
          onRemoteStream: (peerId, stream) => attachRemoteAudio(peerId, stream),
          onPeerRemoved: (peerId) => removePeerAudio(peerId),
        })
        await manager.init()
      }
      const client = await ensureStompConnected()
      stompClient = client

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      rawMicStream = rawStream

      const eng = ensureEngine()
      // 초기 볼륨 주입
      const { inputGain, masterVolume } = get()
      eng.setInputGain(inputGain)
      eng.setMasterVolume(masterVolume)
      eng.setDeafened(get().isDeafened)

      const processed = eng.initializeInput(rawStream)
      // Mute 상태면 processed track을 즉시 무음화
      if (get().isMuted) {
        processed.getAudioTracks().forEach((t) => {
          t.enabled = false
        })
      }

      manager.setLocalStream(processed)
      startDetector(roomId)
      stompClient.publish({ destination: `/app/room/${roomId}/voice/start`, body: '{}' })
      // Autoplay 상태 체크
      if (eng.getContextState() === 'suspended') {
        set({ isInVoice: true, isMuted: false, isDeafened: false, error: null, isAudioAutoplayBlocked: true })
      } else {
        set({ isInVoice: true, isMuted: false, isDeafened: false, error: null, isAudioAutoplayBlocked: false })
      }
    } catch (err: unknown) {
      console.error('[voice] join failed:', err)
      cleanupVoiceResources()
      const detail = err instanceof Error ? err.message : '마이크 권한 또는 서버 연결을 확인해 주세요'
      set({ isInVoice: false, error: `음성 통화 연결에 실패했습니다: ${detail}` })
    }
  },

  leaveVoice: () => {
    if (activeRoomId) {
      stompClient?.publish({ destination: `/app/room/${activeRoomId}/voice/end`, body: '{}' })
    }
    cleanupVoiceResources()
    activeRoomId = null
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {} })
  },

  toggleMute: () => {
    const next = !useVoiceStore.getState().isMuted
    const processed = engine?.getProcessedStream()
    if (processed) {
      processed.getAudioTracks().forEach((t) => {
        t.enabled = !next
      })
    } else {
      rawMicStream?.getAudioTracks().forEach((t) => {
        t.enabled = !next
      })
    }
    set({ isMuted: next })
  },

  toggleDeafen: () => {
    const next = !useVoiceStore.getState().isDeafened
    engine?.setDeafened(next)
    set({ isDeafened: next })
  },

  setDevice: async (deviceId: string) => {
    const eng = engine
    if (!rawMicStream || !manager || !activeRoomId || !eng) return
    try {
      const newRaw = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      })
      // Hot-swap: Destination 노드는 유지, Source만 교체
      const processed = eng.replaceInput(newRaw)
      // 이전 raw 정리
      rawMicStream.getAudioTracks().forEach((t) => t.stop())
      rawMicStream = newRaw
      // Mute 상태면 processed track 유지
      if (get().isMuted) {
        processed.getAudioTracks().forEach((t) => {
          t.enabled = false
        })
      }
      // WebRTC sender는 processed track이 동일하므로 replace 불필요하지만, 안전하게 동기화
      // processed가 동일 객체이므로 실제 replace는 no-op에 가깝다
      await manager.replaceLocalStream(processed)
      startDetector(activeRoomId)
    } catch {
      // 장치 전환 실패 — 현재 장치 유지
    }
  },

  unlockAudio,

  handleVoiceMembers: (rawMembers: string[]) => {
    const me = getUid()
    const now = Array.from(new Set(rawMembers))
    const meInVoice = now.includes(me)
    const joinedNow = meInVoice && !wasInVoice
    wasInVoice = meInVoice
    set({ voiceMembers: now })

    if (!meInVoice) {
      cleanupVoiceResources()
      manager = null
      set({ isInVoice: false, isMuted: false, isDeafened: false })
      return
    }

    const mgr = manager
    if (!mgr) return
    for (const id of now) {
      if (id !== me && !mgr.hasPeer(id)) {
        mgr.addPeer(id, joinedNow)
      }
    }
    for (const peerId of Array.from(mgr.peerIds)) {
      if (!now.includes(peerId)) {
        mgr.disconnectPeer(peerId)
      }
    }
  },

  setInputGain: (value: number) => {
    if (!Number.isFinite(value)) return
    const clamped = clampInputGain(value)
    engine?.setInputGain(clamped)
    set({ inputGain: clamped })
    debouncedSaveInputGain(clamped)
  },

  setMasterVolume: (value: number) => {
    if (!Number.isFinite(value)) return
    const clamped = clampMasterVolume(value)
    engine?.setMasterVolume(clamped)
    set({ masterVolume: clamped })
    debouncedSaveMasterVolume(clamped)
  },

  setPeerVolume: (peerId: string, value: number) => {
    if (!Number.isFinite(value)) return
    const clamped = clampPeerVolume(value)
    const isMuted = get().peerMutes[peerId]
    // 실제 게인은 뮤트면 0, 아니면 clamped
    const effective = isMuted ? 0 : clamped
    engine?.setPeerVolume(peerId, effective)
    set((state) => {
      const next = { ...state.peerVolumes, [peerId]: clamped }
      debouncedSavePeerVolumes(next)
      return { peerVolumes: next }
    })
  },

  togglePeerMute: (peerId: string) => {
    const state = get()
    const currentlyMuted = !!state.peerMutes[peerId]
    const nextMuted = !currentlyMuted
    const savedVol = state.peerVolumes[peerId] ?? 1
    engine?.setPeerVolume(peerId, nextMuted ? 0 : savedVol)
    set((s) => ({
      peerMutes: { ...s.peerMutes, [peerId]: nextMuted },
    }))
  },
}))
