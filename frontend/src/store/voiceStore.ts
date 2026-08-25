import { create } from 'zustand'
import type { Client } from '@stomp/stompjs'
import { ensureStompConnected } from '../lib/stomp'
import { WebRtcManager } from '../lib/webrtc'
import { AudioDetector } from '../lib/audioDetector'

// 음성 세션 전역 리소스 (React 상태 아님 — 비동기/스트림 객체)
let manager: WebRtcManager | null = null
let detector: AudioDetector | null = null
let localStream: MediaStream | null = null
let speakerUnsub: { unsubscribe: () => void } | null = null
let stompClient: Client | null = null
let wasInVoice = false
let activeRoomId: string | null = null

export function getUid(): string {
  return localStorage.getItem('talklite_uid') || 'anonymous'
}

function attachRemoteAudio(peerId: string, stream: MediaStream): void {
  const id = `remote-audio-${peerId}`
  let audio = document.getElementById(id) as HTMLAudioElement | null
  if (audio?.srcObject === stream) return
  if (!audio) {
    audio = document.createElement('audio')
    audio.id = id
    audio.autoplay = true
    document.body.appendChild(audio)
  }
  audio.srcObject = stream
  void audio.play().catch(() => {
    // 자동 재생 차단은 사용자 제스처 기반 승인으로 재시도
  })
}

function removePeerAudio(peerId: string): void {
  const audio = document.getElementById(`remote-audio-${peerId}`) as HTMLAudioElement | null
  if (audio) {
    audio.pause()
    audio.srcObject = null
    audio.remove()
  }
}

function cleanupVoiceResources(): void {
  manager?.destroy()
  manager = null
  detector?.stop()
  detector = null
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop())
    localStream = null
  }
  wasInVoice = false
}

function startDetector(roomId: string): void {
  detector?.stop()
  detector = new AudioDetector({
    onTalkingChange: (talking) => {
      stompClient?.publish({
        destination: `/app/room/${roomId}/speaker`,
        body: JSON.stringify({ talking }),
      })
    },
  })
  if (localStream) {
    detector.start(localStream)
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

  connectRoomVoice: (roomId: string) => Promise<void>
  disconnectRoomVoice: () => void
  forceDisconnectVoice: () => void
  joinVoice: (roomId: string) => Promise<void>
  leaveVoice: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  setDevice: (deviceId: string) => Promise<void>
  handleVoiceMembers: (members: string[]) => void
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isInVoice: false,
  isMuted: false,
  isDeafened: false,
  voiceMembers: [],
  speakingUsers: {},
  audioDevices: [],
  error: null,

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      localStream = stream
      manager.setLocalStream(stream)
      startDetector(roomId)
      stompClient.publish({ destination: `/app/room/${roomId}/voice/start`, body: '{}' })
      set({ isInVoice: true, isMuted: false, isDeafened: false, error: null })
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
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !next
    })
    set({ isMuted: next })
  },

  toggleDeafen: () => {
    const next = !useVoiceStore.getState().isDeafened
    const audios = document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-audio-"]')
    audios.forEach((a) => {
      a.muted = next
    })
    set({ isDeafened: next })
  },

  setDevice: async (deviceId: string) => {
    if (!localStream || !manager || !activeRoomId) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      })
      if (useVoiceStore.getState().isMuted) {
        stream.getAudioTracks().forEach((t) => {
          t.enabled = false
        })
      }
      localStream.getAudioTracks().forEach((t) => t.stop())
      localStream = stream
      await manager.replaceLocalStream(stream)
      startDetector(activeRoomId)
    } catch {
      // 장치 전환 실패 — 현재 장치 유지
    }
  },

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
}))
