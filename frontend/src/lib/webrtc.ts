import { ensureStompConnected } from './stomp'
import type { Client, IMessage } from '@stomp/stompjs'

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export type SignalType = 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE'

export interface SignalCandidate {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}

export interface SignalMessage {
  from: string
  to: string
  type: SignalType
  sdp?: string | null
  candidate?: SignalCandidate | null
}

export interface WebRtcManagerOptions {
  roomId: string
  userId: string
  onRemoteStream: (peerId: string, stream: MediaStream) => void
  onPeerRemoved: (peerId: string) => void
}

interface PeerSession {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  isSettingRemoteAnswer: boolean
}

/**
 * 1:N WebRTC Mesh PeerManager (FR-VOICE-01).
 * Perfect Negotiation (polite/impolite) 패턴: polite = myUserId > remoteUserId.
 * makeOffer=true 로 진입한 피어가 OFFER를 개시한다 (신규 음성 진입자 = 협상 개시).
 */
export class WebRtcManager {
  private readonly me: string
  private sessions = new Map<string, PeerSession>()
  private localStream: MediaStream | null = null
  private client: Client | null = null
  private unsub: { unsubscribe: () => void } | null = null
  private readonly opts: WebRtcManagerOptions

  constructor(opts: WebRtcManagerOptions) {
    this.opts = opts
    this.me = opts.userId
  }

  get peerIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  hasPeer(remoteId: string): boolean {
    return this.sessions.has(remoteId)
  }

  async init(): Promise<void> {
    const client = await ensureStompConnected()
    this.client = client
    this.unsub = client.subscribe(`/topic/room/${this.opts.roomId}/signal/${this.me}`, (message: IMessage) => {
      let signal: SignalMessage
      try {
        signal = JSON.parse(message.body)
      } catch {
        return
      }
      if (!signal?.from) return
      this.handleSignal(signal).catch((err: unknown) => {
        console.error('[webrtc] signal handling failed:', err)
      })
    })
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream
    const track = stream.getAudioTracks()[0]
    if (!track) return
    for (const session of this.sessions.values()) {
      const hasAudioSender = session.pc.getSenders().some((sender) => sender.track?.kind === 'audio')
      if (!hasAudioSender) {
        session.pc.addTrack(track, stream)
      }
    }
  }

  /** 오디오 장치 전환: 모든 피어 sender의 트랙을 교체 (FR-VOICE-04) */
  async replaceLocalStream(stream: MediaStream): Promise<void> {
    const track = stream.getAudioTracks()[0]
    this.localStream = stream
    if (!track) return
    for (const session of this.sessions.values()) {
      const sender = session.pc.getSenders().find((s) => s.track?.kind === 'audio')
      if (sender) {
        try {
          await sender.replaceTrack(track)
        } catch {
          // replaceTrack 실패는 개별 피어 한정 — 나머지 계속
        }
      }
    }
  }

  /** 피어 추가. makeOffer=true 이면 (본인이 신규 진입자) 협상을 개시한다. */
  addPeer(remoteId: string, makeOffer = false): void {
    if (remoteId === this.me || this.sessions.has(remoteId)) return
    this.sessions.set(remoteId, this.createSession(remoteId))
    if (makeOffer) {
      this.createOffer(remoteId).catch((err: unknown) => {
        console.error('[webrtc] offer failed for', remoteId, err)
      })
    }
  }

  /** 피어 제거 — PeerConnection close + 원격 트랙 해제 */
  disconnectPeer(peerId: string): void {
    const session = this.sessions.get(peerId)
    if (!session) return
    this.sessions.delete(peerId)
    session.pc.close()
    this.opts.onPeerRemoved(peerId)
  }

  destroy(): void {
    for (const id of Array.from(this.sessions.keys())) this.disconnectPeer(id)
    this.unsub?.unsubscribe()
    this.unsub = null
    this.client = null
    this.localStream = null
  }

  private createSession(remoteId: string): PeerSession {
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const session: PeerSession = {
      pc,
      polite: this.me > remoteId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswer: false,
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate: SignalCandidate = {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }
        this.publishSignal(remoteId, {
          from: this.me,
          to: remoteId,
          type: 'ICE_CANDIDATE',
          sdp: null,
          candidate,
        })
      }
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) {
        this.opts.onRemoteStream(remoteId, stream)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.sessions.delete(remoteId)
        this.opts.onPeerRemoved(remoteId)
      }
    }

    const stream = this.localStream
    const track = stream?.getAudioTracks()[0]
    if (track && !pc.getSenders().some((sender) => sender.track?.kind === 'audio')) {
      pc.addTrack(track, stream)
    }
    return session
  }

  private async createOffer(remoteId: string): Promise<void> {
    const session = this.sessions.get(remoteId)
    if (!session || !this.client) return
    session.makingOffer = true
    try {
      await session.pc.setLocalDescription()
      if (session.pc.localDescription?.sdp) {
        this.publishSignal(remoteId, {
          from: this.me,
          to: remoteId,
          type: 'OFFER',
          sdp: session.pc.localDescription.sdp,
          candidate: null,
        })
      }
    } finally {
      session.makingOffer = false
    }
  }

  private async handleSignal(signal: SignalMessage): Promise<void> {
    const remoteId = signal.from
    const session = this.sessions.get(remoteId) ?? this.createSession(remoteId)
    this.sessions.set(remoteId, session)

    if (signal.sdp) {
      const description: RTCSessionDescriptionInit = {
        type: signal.type === 'ANSWER' ? 'answer' : 'offer',
        sdp: signal.sdp,
      }
      const offerCollision = description.type === 'offer' && (session.makingOffer || session.pc.signalingState !== 'stable')
      session.ignoreOffer = !session.polite && offerCollision
      if (session.ignoreOffer) return
      session.isSettingRemoteAnswer = description.type === 'answer'
      try {
        await session.pc.setRemoteDescription(description)
      } finally {
        session.isSettingRemoteAnswer = false
      }
      if (description.type === 'offer') {
        await session.pc.setLocalDescription()
        if (session.pc.localDescription?.sdp) {
          this.publishSignal(remoteId, {
            from: this.me,
            to: remoteId,
            type: 'ANSWER',
            sdp: session.pc.localDescription.sdp,
            candidate: null,
          })
        }
      }
      return
    }

    if (signal.candidate) {
      try {
        await session.pc.addIceCandidate(signal.candidate as RTCIceCandidateInit)
      } catch (err) {
        if (!session.ignoreOffer) {
          console.error('[webrtc] addIceCandidate failed for', remoteId, err)
        }
      }
    }
  }

  private publishSignal(_to: string, payload: SignalMessage): void {
    const client = this.client
    if (!client || !client.connected) return
    client.publish({ destination: `/app/room/${this.opts.roomId}/signal`, body: JSON.stringify(payload) })
  }
}
