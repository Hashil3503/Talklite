import { create } from 'zustand'
import type { Client } from '@stomp/stompjs'
import { ensureStompConnected } from '../lib/stomp'
import { WebRtcManager } from '../lib/webrtc'
import { AudioDetector } from '../lib/audioDetector'
import { VoiceAudioEngineImpl } from '../lib/voiceAudioEngine'
import { isDenoiserSupported, isNoiseSuppressionModel, type NoiseSuppressionModel } from '../lib/noise/types'

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
const LS_INPUT_MODE = 'talklite_input_mode'
const LS_PTT_KEY = 'talklite_ptt_key'
// Phase 12 — AI 잡음 제거 영구 기억 (화이트리스트 검증)
const LS_AI_NOISE_ENABLED = 'talklite_ai_noise_enabled'
const LS_AI_NOISE_MODEL = 'talklite_ai_noise_model'

let inputGainTimer: ReturnType<typeof setTimeout> | null = null
let masterTimer: ReturnType<typeof setTimeout> | null = null
let peerVolumesTimer: ReturnType<typeof setTimeout> | null = null

// ── Phase 9 PTT & MicTest globals
let pttReleaseTimer: ReturnType<typeof setTimeout> | null = null
let mediaRecorder: MediaRecorder | null = null
let micTestChunks: Blob[] = []
let micTestStream: MediaStream | null = null
let micTestUrl: string | null = null
let micTestAudio: HTMLAudioElement | null = null
let micTestTimeout: ReturnType<typeof setTimeout> | null = null
let micTestAborted = false
let supportedMimeTypeCache: string | null = null

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

export type VoiceInputMode = 'voice_activity' | 'push_to_talk'

function loadInputMode(): VoiceInputMode {
  try {
    const raw = localStorage.getItem(LS_INPUT_MODE)
    if (raw === 'push_to_talk' || raw === 'voice_activity') return raw
  } catch {
    /* ignore */
  }
  return 'voice_activity'
}
function loadPttKey(): string {
  try {
    const raw = localStorage.getItem(LS_PTT_KEY)
    if (raw && typeof raw === 'string' && raw.length > 0) return raw
  } catch {
    /* ignore */
  }
  return 'KeyT'
}

// Phase 12 — AI 노이즈 제거 영속화 (화이트리스트 검증 탑재)
function loadAiNoiseEnabled(): boolean {
  try {
    return localStorage.getItem(LS_AI_NOISE_ENABLED) === 'true'
  } catch {
    /* ignore */
  }
  return false
}
function loadAiNoiseModel(): NoiseSuppressionModel {
  try {
    const raw = localStorage.getItem(LS_AI_NOISE_MODEL)
    if (isNoiseSuppressionModel(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'rnnoise'
}
function saveAiNoiseEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_AI_NOISE_ENABLED, String(enabled))
  } catch {
    /* ignore */
  }
}
function saveAiNoiseModel(model: NoiseSuppressionModel): void {
  try {
    localStorage.setItem(LS_AI_NOISE_MODEL, model)
  } catch {
    /* ignore */
  }
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
  const state = useVoiceStore.getState()
  const savedVol = state.peerVolumes[peerId]
  if (savedVol !== undefined) {
    eng.setPeerVolume(peerId, savedVol)
  }
  if (state.peerMutes[peerId]) {
    eng.setPeerVolume(peerId, 0)
  }
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
  useVoiceStore.setState({ isAudioAutoplayBlocked: !ok })
}

function removePeerAudio(peerId: string): void {
  engine?.removeRemote(peerId)
}

function getSupportedMimeType(): string {
  if (supportedMimeTypeCache !== null) return supportedMimeTypeCache
  const candidates = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
  if (typeof MediaRecorder === 'undefined') {
    supportedMimeTypeCache = ''
    return supportedMimeTypeCache
  }
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        supportedMimeTypeCache = candidate
        return candidate
      }
    } catch {
      continue
    }
  }
  supportedMimeTypeCache = ''
  return supportedMimeTypeCache
}

function createMicTestRecorder(stream: MediaStream): MediaRecorder {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this browser')
  }
  const candidates = [
    getSupportedMimeType(),
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    '',
  ].filter((value, index, values) => values.indexOf(value) === index)
  let lastError: unknown = new Error('MediaRecorder is not supported')

  for (const mimeType of candidates) {
    try {
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      supportedMimeTypeCache = mimeType
      return recorder
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

function cleanupMicTestInternal(): void {
  if (micTestTimeout) {
    clearTimeout(micTestTimeout)
    micTestTimeout = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    } catch {
      // ignore
    }
  }
  mediaRecorder = null
  micTestChunks = []
  if (micTestStream) {
    micTestStream.getTracks().forEach((t) => t.stop())
    micTestStream = null
  }
  if (micTestAudio) {
    try {
      micTestAudio.pause()
      micTestAudio.src = ''
    } catch {
      // ignore
    }
    micTestAudio = null
  }
  if (micTestUrl) {
    try {
      URL.revokeObjectURL(micTestUrl)
    } catch {
      // ignore
    }
    micTestUrl = null
  }
}

function cleanupVoiceResources(): void {
  micTestAborted = true
  manager?.destroy()
  manager = null
  detector?.stop()
  detector = null
  cleanupMicTestInternal()
  if (rawMicStream) {
    rawMicStream.getTracks().forEach((t) => t.stop())
    rawMicStream = null
  }
  engine?.destroy()
  engine = null
  wasInVoice = false
  // Phase 12 — 노이즈 로딩 상태 리셋 (엔진 파괴 시 대기 중 상태 방지)
  if (useVoiceStore.getState().isNoiseLoading) {
    useVoiceStore.setState({ isNoiseLoading: false })
  }
  // PTT 릴리즈 타이머 정리 (Stuck 해제)
  if (pttReleaseTimer) {
    clearTimeout(pttReleaseTimer)
    pttReleaseTimer = null
  }
}

function applyTransmitState(): void {
  const s = useVoiceStore.getState()
  const shouldTransmit = !s.isMuted && (s.inputMode === 'voice_activity' || s.isPttActive)
  const proc = engine?.getProcessedStream()
  const track = proc?.getAudioTracks()[0] ?? rawMicStream?.getAudioTracks()[0] ?? null
  if (track) {
    track.enabled = shouldTransmit
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    if (target.closest('[contenteditable]')) return true
  }
  return false
}

function handlePttKeyDown(e: KeyboardEvent): void {
  const { inputMode, pttKey, isPttActive } = useVoiceStore.getState()
  if (inputMode !== 'push_to_talk') return
  if (e.code !== pttKey) return
  if (e.repeat) return
  if (e.isComposing) return
  if (isTypingTarget(e.target)) return
  if (isPttActive) return
  if (pttReleaseTimer) {
    clearTimeout(pttReleaseTimer)
    pttReleaseTimer = null
  }
  useVoiceStore.setState({ isPttActive: true })
  applyTransmitState()
}

function handlePttKeyUp(e: KeyboardEvent): void {
  const { inputMode, pttKey } = useVoiceStore.getState()
  if (inputMode !== 'push_to_talk') return
  if (e.code !== pttKey) return
  if (pttReleaseTimer) clearTimeout(pttReleaseTimer)
  pttReleaseTimer = setTimeout(() => {
    pttReleaseTimer = null
    const s = useVoiceStore.getState()
    if (!s.isPttActive) return
    useVoiceStore.setState({ isPttActive: false })
    applyTransmitState()
  }, 200)
}

function handlePttStuckRelease(): void {
  if (pttReleaseTimer) {
    clearTimeout(pttReleaseTimer)
    pttReleaseTimer = null
  }
  const s = useVoiceStore.getState()
  if (s.isPttActive) {
    useVoiceStore.setState({ isPttActive: false })
    applyTransmitState()
  }
}

function startDetector(roomId: string): void {
  detector?.stop()
  const analyser = engine?.getAnalyser() ?? null
  if (analyser) {
    detector = new AudioDetector({
      threshold: 0.02,
      hangoverMs: 300,
      onTalkingChange: (talking) => {
        if (useVoiceStore.getState().isMuted) return
        stompClient?.publish({
          destination: `/app/room/${roomId}/speaker`,
          body: JSON.stringify({ talking }),
        })
      },
      onVuLevel: (level) => {
        useVoiceStore.setState({ micVolumeLevel: level })
      },
      analyser,
    })
    detector.startWithAnalyser(analyser)
  } else {
    const streamForDetector = engine?.getProcessedStream() ?? rawMicStream ?? null
    if (!streamForDetector) return
    detector = new AudioDetector({
      threshold: 0.02,
      hangoverMs: 300,
      onTalkingChange: (talking) => {
        if (useVoiceStore.getState().isMuted) return
        stompClient?.publish({
          destination: `/app/room/${roomId}/speaker`,
          body: JSON.stringify({ talking }),
        })
      },
      onVuLevel: (level) => {
        useVoiceStore.setState({ micVolumeLevel: level })
      },
    })
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
  // Phase 9
  inputMode: VoiceInputMode
  pttKey: string
  isPttActive: boolean
  isTestingMic: boolean
  micVolumeLevel: number
  micTestUrl: string | null
  // Phase 12 — AI 잡음 제거
  isNoiseSuppressionEnabled: boolean
  noiseSuppressionModel: NoiseSuppressionModel
  isNoiseLoading: boolean
  noiseError: string | null
  isDenoiserSupported: boolean

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
  // Phase 9 setters
  setInputMode: (mode: VoiceInputMode) => void
  setPttKey: (code: string) => void
  startMicTest: () => Promise<void>
  stopMicTest: () => void
  // Phase 12
  setNoiseSuppression: (enabled: boolean, model?: NoiseSuppressionModel) => Promise<void>
  setNoiseSuppressionModel: (model: NoiseSuppressionModel) => Promise<void>
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
  inputMode: loadInputMode(),
  pttKey: loadPttKey(),
  isPttActive: false,
  isTestingMic: false,
  micVolumeLevel: 0,
  micTestUrl: null,
  isNoiseSuppressionEnabled: loadAiNoiseEnabled(),
  noiseSuppressionModel: loadAiNoiseModel(),
  isNoiseLoading: false,
  noiseError: null,
  isDenoiserSupported: isDenoiserSupported(),

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
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {}, isPttActive: false, micVolumeLevel: 0 })
  },

  forceDisconnectVoice: () => {
    speakerUnsub?.unsubscribe()
    speakerUnsub = null
    cleanupVoiceResources()
    activeRoomId = null
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {}, isPttActive: false, micVolumeLevel: 0 })
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
      const { inputGain, masterVolume } = get()
      eng.setInputGain(inputGain)
      eng.setMasterVolume(masterVolume)
      eng.setDeafened(get().isDeafened)

      const processed = eng.initializeInput(rawStream)
      // 초기 송신 상태 적용 (PTT 모드면 무음, voice_activity면 송신)
      applyTransmitState()
      // Mute 상태 동기화 보조: applyTransmitState가 이미 처리하지만, 초기 false 보장
      const shouldTransmit = !get().isMuted && (get().inputMode === 'voice_activity' || get().isPttActive)
      processed.getAudioTracks().forEach((t) => {
        t.enabled = shouldTransmit
      })

      manager.setLocalStream(processed)
      startDetector(roomId)
      // Phase 12 — 영구 기억된 AI 잡음 제거 설정 복원 적용 (실패 시 Graceful Fallback)
      const noiseState = get()
      if (noiseState.isDenoiserSupported && noiseState.isNoiseSuppressionEnabled) {
        set({ isNoiseLoading: true })
        try {
          const ok = await eng.setNoiseSuppression(true, noiseState.noiseSuppressionModel)
          set({
            isNoiseLoading: false,
            isNoiseSuppressionEnabled: ok,
            noiseError: ok ? null : '잡음 제거 엔진 로딩에 실패하여 일반 마이크 모드로 전환되었습니다.',
          })
          saveAiNoiseEnabled(ok)
        } catch {
          set({ isNoiseLoading: false, isNoiseSuppressionEnabled: false, noiseError: null })
          saveAiNoiseEnabled(false)
        }
      }
      stompClient.publish({ destination: `/app/room/${roomId}/voice/start`, body: '{}' })
      if (eng.getContextState() === 'suspended') {
        set({ isInVoice: true, isMuted: false, isDeafened: false, error: null, isAudioAutoplayBlocked: true })
      } else {
        set({ isInVoice: true, isMuted: false, isDeafened: false, error: null, isAudioAutoplayBlocked: false })
      }
      // 재적용 (isMuted 리셋 후)
      applyTransmitState()
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
    set({ isInVoice: false, isMuted: false, isDeafened: false, voiceMembers: [], speakingUsers: {}, isPttActive: false, micVolumeLevel: 0, isTestingMic: false })
  },

  toggleMute: () => {
    const next = !useVoiceStore.getState().isMuted
    set({ isMuted: next })
    applyTransmitState()
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
      const processed = eng.replaceInput(newRaw)
      rawMicStream.getAudioTracks().forEach((t) => t.stop())
      rawMicStream = newRaw
      applyTransmitState()
      // processed가 동일 객체지만 enabled 상태 보정
      const should = !get().isMuted && (get().inputMode === 'voice_activity' || get().isPttActive)
      processed.getAudioTracks().forEach((t) => {
        t.enabled = should
      })
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
      set({ isInVoice: false, isMuted: false, isDeafened: false, isPttActive: false, micVolumeLevel: 0 })
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

  setInputMode: (mode: VoiceInputMode) => {
    if (mode !== 'voice_activity' && mode !== 'push_to_talk') return
    set({ inputMode: mode })
    try {
      localStorage.setItem(LS_INPUT_MODE, mode)
    } catch {
      // ignore
    }
    if (mode === 'voice_activity') {
      // PTT 해제
      if (pttReleaseTimer) {
        clearTimeout(pttReleaseTimer)
        pttReleaseTimer = null
      }
      set({ isPttActive: false })
    }
    applyTransmitState()
  },

  setPttKey: (code: string) => {
    if (!code || typeof code !== 'string') return
    const trimmed = code.trim()
    if (!trimmed) return
    set({ pttKey: trimmed })
    try {
      localStorage.setItem(LS_PTT_KEY, trimmed)
    } catch {
      // ignore
    }
  },

  startMicTest: async () => {
    const s = get()
    if (s.isTestingMic) return
    // 기존 테스트 정리
    micTestAborted = true
    cleanupMicTestInternal()
    micTestAborted = false
    set({ isTestingMic: true, micTestUrl: null })

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      micTestStream = stream
      const recorder = createMicTestRecorder(stream)
      mediaRecorder = recorder
      micTestChunks = []

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) micTestChunks.push(e.data)
      }

      recorder.onstop = () => {
        if (micTestAborted) {
          cleanupMicTestInternal()
          useVoiceStore.setState({ isTestingMic: false, micTestUrl: null })
          return
        }
        try {
          const blob = new Blob(micTestChunks, { type: recorder.mimeType || 'audio/webm' })
          const url = URL.createObjectURL(blob)
          micTestUrl = url
          const audio = new Audio(url)
          micTestAudio = audio
          useVoiceStore.setState({ micTestUrl: url })
          const onDone = (): void => {
            cleanupMicTestInternal()
            useVoiceStore.setState({ isTestingMic: false, micTestUrl: null })
          }
          audio.onended = onDone
          audio.onerror = onDone
          void audio.play().catch(() => onDone())
        } catch {
          cleanupMicTestInternal()
          useVoiceStore.setState({ isTestingMic: false, micTestUrl: null })
        }
      }

      recorder.start()

      micTestTimeout = setTimeout(() => {
        try {
          if (recorder.state === 'recording') recorder.stop()
        } catch {
          // ignore
        }
      }, 3000)
    } catch (err) {
      console.error('[micTest] failed', err)
      cleanupMicTestInternal()
      set({ isTestingMic: false, micTestUrl: null })
    }
  },

  stopMicTest: () => {
    micTestAborted = true
    cleanupMicTestInternal()
    set({ isTestingMic: false, micTestUrl: null })
  },

  // ── Phase 12: AI 잡음 제거 (온디맨드 로딩 + Graceful Fallback) ──
  setNoiseSuppression: async (enabled: boolean, model?: NoiseSuppressionModel) => {
    const state = get()
    if (!state.isDenoiserSupported) {
      set({ noiseError: '이 브라우저는 AI 잡음 제거(AudioWorklet/WASM)를 지원하지 않습니다.' })
      return
    }
    const targetModel = model ?? state.noiseSuppressionModel
    if (!isNoiseSuppressionModel(targetModel)) return
    if (state.isNoiseLoading) return

    // 미통화 중: 상태/영속화만 반영 (통화 참여 시 파이프라인 적용)
    if (!engine || !state.isInVoice) {
      set({
        isNoiseSuppressionEnabled: enabled,
        noiseSuppressionModel: targetModel,
        noiseError: null,
      })
      saveAiNoiseEnabled(enabled)
      saveAiNoiseModel(targetModel)
      return
    }

    set({ isNoiseLoading: true, noiseError: null })
    const ok = await engine.setNoiseSuppression(enabled, targetModel)
    set({
      isNoiseLoading: false,
      isNoiseSuppressionEnabled: ok ? enabled : false,
      noiseError: ok ? null : '잡음 제거 엔진 로딩에 실패하여 일반 마이크 모드로 전환되었습니다.',
    })
    // Fallback 시에도 사용자 선택(model)은 기억, enabled는 실패면 false로 영속화
    saveAiNoiseEnabled(ok ? enabled : false)
    saveAiNoiseModel(targetModel)
  },

  setNoiseSuppressionModel: async (model: NoiseSuppressionModel) => {
    if (!isNoiseSuppressionModel(model)) return
    const state = get()
    if (!state.isDenoiserSupported) {
      set({ noiseError: '이 브라우저는 AI 잡음 제거(AudioWorklet/WASM)를 지원하지 않습니다.' })
      return
    }
    set({ noiseSuppressionModel: model })
    saveAiNoiseModel(model)
    if (state.isInVoice && engine && state.isNoiseSuppressionEnabled) {
      await get().setNoiseSuppression(true, model)
    }
  },
}))

function handleVisibilityChange(): void {
  if (document.hidden) handlePttStuckRelease()
}

// ── PTT 전역 리스너 (스토어 생성 후 등록 — TDZ 회피)
if (typeof window !== 'undefined') {
  window.removeEventListener('keydown', handlePttKeyDown)
  window.removeEventListener('keyup', handlePttKeyUp)
  window.removeEventListener('blur', handlePttStuckRelease)
  window.removeEventListener('pagehide', handlePttStuckRelease)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('contextmenu', handlePttStuckRelease)
  window.addEventListener('keydown', handlePttKeyDown)
  window.addEventListener('keyup', handlePttKeyUp)
  window.addEventListener('blur', handlePttStuckRelease)
  window.addEventListener('pagehide', handlePttStuckRelease)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('contextmenu', handlePttStuckRelease)
}
