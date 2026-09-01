/**
 * Phase 8 VoiceAudioEngine — Web Audio 기반 정밀 볼륨 제어 엔진.
 * 송신: rawMicStream -> Source -> [DenoiseWorklet(Phase 12, 옵션)] -> inputGain(0~2.0) -> DynamicsCompressor(-6dB 12:1) -> Destination
 * 수신: peer Stream -> Source -> peerGain(0~2.0) -> masterGain(0~1.0) -> AudioContext.destination
 *
 * Phase 12 단순 스왑 파이프라인 (P0-4): 이중 Gain 병렬·크로스페이드 제거
 * OFF: source -> inputGain -> compressor -> destination
 * ON:  source -> workletNode -> inputGain -> compressor -> destination
 * Destination 불변, denoiseSeq 경합 가드, WASM 실패 시 Graceful Fallback.
 */

import { createDenoiseNode, disposeHandle, type DenoiseEngineHandle } from './noise/denoiseEngine'
import type { NoiseSuppressionModel } from './noise/types'

export interface VoiceAudioEngine {
  initializeInput(rawStream: MediaStream): MediaStream
  replaceInput(rawStream: MediaStream): MediaStream
  attachRemote(peerId: string, stream: MediaStream): void
  removeRemote(peerId: string): void
  setInputGain(value: number): void
  setPeerVolume(peerId: string, value: number): void
  setMasterVolume(value: number): void
  setDeafened(value: boolean): void
  resume(): Promise<boolean>
  destroy(): void
  getProcessedStream(): MediaStream | null
  getContextState(): AudioContextState | null
  getAnalyser(): AnalyserNode | null
  setNoiseSuppression(enabled: boolean, model: NoiseSuppressionModel): Promise<boolean>
}

interface PeerOutput {
  source: MediaStreamAudioSourceNode
  gain: GainNode
  stream: MediaStream
  audioEl?: HTMLAudioElement
}

export class VoiceAudioEngineImpl implements VoiceAudioEngine {
  private ctx: AudioContext | null = null
  private inputSource: MediaStreamAudioSourceNode | null = null
  private inputGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private peerMap = new Map<string, PeerOutput>()
  // @ts-ignore TS6133: kept for lifecycle parity (hot-swap tracking)
  private rawInputStream: MediaStream | null = null
  private isDeafened = false
  private storedMasterVolume = 1
  private currentMasterVolume = 1
  private currentInputGain = 1

  // Phase 12 — 단순 스왑: 단일 worklet 노드로 축소 (이중 Gain 제거)
  private denoiseHandle: DenoiseEngineHandle | null = null
  private denoiseSeq = 0
  private noiseSuppressionEnabled = false
  private noiseSuppressionModel: NoiseSuppressionModel = 'rnnoise'

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const AudioCtor =
      window.AudioContext || ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext | undefined)
    if (!AudioCtor) throw new Error('Web Audio API not supported in this browser')
    let ctx: AudioContext
    try {
      ctx = new AudioCtor({ latencyHint: 'interactive', sampleRate: 48000 } as AudioContextOptions)
    } catch {
      ctx = new AudioCtor()
    }
    this.ctx = ctx

    const inputGain = ctx.createGain()
    inputGain.gain.value = this.currentInputGain
    this.inputGain = inputGain

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -6
    compressor.knee.value = 12
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    this.compressor = compressor

    const destination = ctx.createMediaStreamDestination()
    this.destination = destination

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    this.analyser = analyser

    const masterGain = ctx.createGain()
    masterGain.gain.value = this.isDeafened ? 0 : this.currentMasterVolume
    masterGain.connect(ctx.destination)
    this.masterGain = masterGain

    // inputGain -> compressor -> destination, inputGain -> analyser (단순 파이프라인)
    inputGain.connect(compressor)
    inputGain.connect(analyser)
    compressor.connect(destination)

    return ctx
  }

  initializeInput(rawStream: MediaStream): MediaStream {
    const ctx = this.ensureContext()
    this.rawInputStream = rawStream

    if (this.inputSource) {
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      this.inputSource = null
    }

    // destination 불변: 누락 노드 개별 재생성
    if (!this.inputGain || !this.compressor || !this.destination || !this.analyser || !this.masterGain) {
      if (!this.inputGain) {
        const inputGain = ctx.createGain()
        inputGain.gain.value = this.currentInputGain
        this.inputGain = inputGain
      }
      if (!this.compressor) {
        const compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -6
        compressor.knee.value = 12
        compressor.ratio.value = 12
        compressor.attack.value = 0.003
        compressor.release.value = 0.25
        this.compressor = compressor
      }
      if (!this.destination) {
        this.destination = ctx.createMediaStreamDestination()
      }
      if (!this.analyser) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        this.analyser = analyser
      }
      if (!this.masterGain) {
        const mg = ctx.createGain()
        mg.gain.value = this.isDeafened ? 0 : this.currentMasterVolume
        mg.connect(ctx.destination)
        this.masterGain = mg
        for (const peer of this.peerMap.values()) {
          try {
            peer.gain.disconnect()
          } catch {
            // ignore
          }
          peer.gain.connect(mg)
        }
      }
      try {
        this.inputGain!.disconnect()
      } catch {
        // ignore
      }
      try {
        this.compressor!.disconnect()
      } catch {
        // ignore
      }
      try {
        this.analyser!.disconnect()
      } catch {
        // ignore
      }
      this.inputGain!.connect(this.compressor!)
      this.inputGain!.connect(this.analyser!)
      this.compressor!.connect(this.destination!)
    }

    const source = ctx.createMediaStreamSource(rawStream)
    this.inputSource = source
    // 단일 스왑 헬퍼로 일원화: OFF는 source->inputGain, ON은 source->worklet->inputGain
    this.rewireInputSource(source)

    return this.destination ? this.destination.stream : rawStream
  }

  /** 단순 스왑: OFF source->inputGain / ON source->worklet->inputGain (어떤 경우에도 단절 없음) */
  private rewireInputSource(source: MediaStreamAudioSourceNode): void {
    if (!this.inputGain) return
    // 기존 연결 정리 — source와 worklet 모두 disconnect 후 재연결로 간선 수 불변 보장
    try {
      source.disconnect()
    } catch {
      // ignore
    }
    if (this.denoiseHandle) {
      try {
        this.denoiseHandle.node.disconnect()
      } catch {
        // ignore
      }
    }
    if (this.noiseSuppressionEnabled && this.denoiseHandle) {
      // ON: source -> worklet -> inputGain
      try {
        source.connect(this.denoiseHandle.node)
      } catch {
        // ignore
      }
      try {
        this.denoiseHandle.node.connect(this.inputGain)
      } catch {
        // ignore
      }
    } else {
      // OFF: source -> inputGain
      try {
        source.connect(this.inputGain)
      } catch {
        // ignore
      }
    }
  }

  replaceInput(newStream: MediaStream): MediaStream {
    if (!this.ctx || !this.inputGain || !this.destination) {
      return this.initializeInput(newStream)
    }
    this.rawInputStream = newStream
    if (this.inputSource) {
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      this.inputSource = null
    }
    const source = this.ctx.createMediaStreamSource(newStream)
    this.inputSource = source
    this.rewireInputSource(source)
    return this.destination.stream
  }

  attachRemote(peerId: string, stream: MediaStream): void {
    if (!this.ctx || !this.masterGain) {
      this.ensureContext()
    }
    const ctx = this.ctx
    const master = this.masterGain
    if (!ctx || !master) return

    // P0-5: suspended 시 resume 시도 — 원격 무음 방지
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // ignore
      })
    }

    const existing = this.peerMap.get(peerId)
    if (existing) {
      if (existing.stream === stream) {
        // P1-5: 동일 stream이라도 볼륨·mute 상태가 바뀌었을 수 있으므로 early return 전에 볼륨은 상위에서 재적용됨
        // 여기서는 peerMap 갱신 없이 반환하되, 상위 attachRemoteAudio에서 setPeerVolume 보장
        return
      }
      try {
        existing.source.disconnect()
        existing.gain.disconnect()
      } catch {
        // ignore
      }
      this.peerMap.delete(peerId)
    }

    const source = ctx.createMediaStreamSource(stream)
    const gain = ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(master)

    // P0-3: Chrome Web Audio 무음 회피 — 숨김 <audio> 병행 재생 (Chromium Issue 1216734)
    let audioEl: HTMLAudioElement | undefined
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const audio = document.createElement('audio')
        audio.autoplay = true
        ;(audio as unknown as { playsInline: boolean }).playsInline = true
        audio.style.display = 'none'
        audio.muted = this.isDeafened
        audio.volume = 1
        audio.srcObject = stream
        // body가 없으면 append 생략 (테스트 환경)
        if (document.body) document.body.appendChild(audio)
        void audio.play().catch(() => {
          // Autoplay 차단 시 voiceStore isAudioAutoplayBlocked 배너로 노출됨
        })
        audioEl = audio
      } catch {
        // ignore — audio 생성 실패 시 Web Audio 경로만 유지
      }
    }

    this.peerMap.set(peerId, { source, gain, stream, audioEl })
  }

  removeRemote(peerId: string): void {
    const entry = this.peerMap.get(peerId)
    if (!entry) return
    if (entry.audioEl) {
      try {
        entry.audioEl.srcObject = null
        entry.audioEl.remove()
      } catch {
        // ignore
      }
    }
    try {
      entry.source.disconnect()
    } catch {
      // ignore
    }
    try {
      entry.gain.disconnect()
    } catch {
      // ignore
    }
    this.peerMap.delete(peerId)
  }

  setInputGain(value: number): void {
    const clamped = Math.min(2, Math.max(0, value))
    this.currentInputGain = clamped
    if (this.inputGain) {
      this.inputGain.gain.value = clamped
    }
  }

  setPeerVolume(peerId: string, value: number): void {
    const clamped = Math.min(2, Math.max(0, value))
    const entry = this.peerMap.get(peerId)
    if (entry) {
      entry.gain.gain.value = clamped
      if (entry.audioEl) {
        try {
          // HTMLAudioElement volume은 0~1 범위 — Web Audio gain은 0~2이므로 클램프
          entry.audioEl.volume = Math.min(1, Math.max(0, clamped))
        } catch {
          // ignore
        }
      }
    }
  }

  setMasterVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value))
    this.currentMasterVolume = clamped
    if (!this.isDeafened) {
      this.storedMasterVolume = clamped
      if (this.masterGain) {
        this.masterGain.gain.value = clamped
      }
    } else {
      this.storedMasterVolume = clamped
    }
  }

  setDeafened(value: boolean): void {
    this.isDeafened = value
    if (this.masterGain) {
      if (value) {
        this.masterGain.gain.value = 0
      } else {
        this.masterGain.gain.value = this.storedMasterVolume
      }
    }
    // P0-3: audio 엘리먼트도 deafen 동기화 (Chrome 병행 경로)
    for (const entry of this.peerMap.values()) {
      if (entry.audioEl) {
        try {
          entry.audioEl.muted = value
        } catch {
          // ignore
        }
      }
    }
  }

  async resume(): Promise<boolean> {
    if (!this.ctx) return false
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        return false
      }
    }
    return this.ctx.state === 'running'
  }

  getProcessedStream(): MediaStream | null {
    void this.rawInputStream
    return this.destination ? this.destination.stream : null
  }

  getContextState(): AudioContextState | null {
    return this.ctx ? this.ctx.state : null
  }

  setNoiseSuppression(enabled: boolean, model: NoiseSuppressionModel): Promise<boolean> {
    return this.applyNoiseSuppression(enabled, model)
  }

  /**
   * 단순 스왑 denoise 전환 (P0-4)
   * OFF: source -> inputGain
   * ON:  source -> worklet -> inputGain
   * Destination 불변, seq 경합 가드, 실패 시 bypass 유지
   */
  private async applyNoiseSuppression(enabled: boolean, model: NoiseSuppressionModel): Promise<boolean> {
    if (!this.ctx || !this.inputSource || !this.inputGain) return false
    const ctx = this.ctx
    const seq = ++this.denoiseSeq

    this.noiseSuppressionModel = model

    if (!enabled) {
      this.noiseSuppressionEnabled = false
      // 원자 스왑: source를 worklet에서 분리해 inputGain으로 직접 연결
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      if (this.denoiseHandle) {
        try {
          this.denoiseHandle.node.disconnect()
        } catch {
          // ignore
        }
      }
      try {
        this.inputSource.connect(this.inputGain)
      } catch {
        // ignore
      }
      if (seq === this.denoiseSeq) {
        this.teardownDenoiseNodes()
      }
      return true
    }

    // ON: 이미 같은 모델로 ON이면 재연결 보장 후 반환
    if (this.noiseSuppressionEnabled && this.denoiseHandle && this.denoiseHandle.model === model) {
      // 이미 ON — 간선 보장 (suspended resume 등으로 끊겼을 수 있음)
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      try {
        this.denoiseHandle.node.disconnect()
      } catch {
        // ignore
      }
      try {
        this.inputSource.connect(this.denoiseHandle.node)
      } catch {
        // ignore
      }
      try {
        this.denoiseHandle.node.connect(this.inputGain)
      } catch {
        // ignore
      }
      return true
    }

    try {
      const needsNewNode = !this.denoiseHandle || this.denoiseHandle.model !== model
      if (needsNewNode) {
        const oldHandle = this.denoiseHandle
        const node = await createDenoiseNode(ctx, model)
        if (seq !== this.denoiseSeq) {
          disposeHandle({ model, node, dispose: () => {} })
          return false
        }
        if (oldHandle) {
          disposeHandle(oldHandle)
        }
        this.denoiseHandle = { model, node, dispose: () => disposeHandle({ model, node, dispose: () => {} }) }
      }
      // 원자 스왑: source -> worklet -> inputGain
      const handle = this.denoiseHandle!
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      try {
        handle.node.disconnect()
      } catch {
        // ignore
      }
      try {
        this.inputSource.connect(handle.node)
      } catch {
        // ignore
      }
      try {
        handle.node.connect(this.inputGain)
      } catch {
        // ignore
      }

      this.noiseSuppressionEnabled = true
      return true
    } catch (err) {
      console.error('[voice] noise suppression load failed, falling back to bypass:', err)
      if (seq === this.denoiseSeq) {
        this.noiseSuppressionEnabled = false
        // bypass로 복구
        try {
          this.inputSource.disconnect()
        } catch {
          // ignore
        }
        if (this.denoiseHandle) {
          try {
            this.denoiseHandle.node.disconnect()
          } catch {
            // ignore
          }
        }
        try {
          this.inputSource.connect(this.inputGain)
        } catch {
          // ignore
        }
        this.teardownDenoiseNodes()
      }
      return false
    }
  }

  /** denoise 노드 해제 — 단일 노드만 정리 */
  private teardownDenoiseNodes(): void {
    if (this.denoiseHandle) {
      try {
        this.denoiseHandle.node.disconnect()
      } catch {
        // ignore
      }
      disposeHandle(this.denoiseHandle)
      this.denoiseHandle = null
    }
  }

  getNoiseSuppressionState(): { enabled: boolean; model: NoiseSuppressionModel } {
    return { enabled: this.noiseSuppressionEnabled, model: this.noiseSuppressionModel }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  destroy(): void {
    // P1-4: denoise -> peerMap -> source -> ctx 순서 고정 (+ audioEl 정리)
    this.teardownDenoiseNodes()
    this.noiseSuppressionEnabled = false
    this.denoiseSeq++

    for (const [, entry] of this.peerMap) {
      if (entry.audioEl) {
        try {
          entry.audioEl.srcObject = null
          entry.audioEl.remove()
        } catch {
          // ignore
        }
      }
      try {
        entry.source.disconnect()
      } catch {
        // ignore
      }
      try {
        entry.gain.disconnect()
      } catch {
        // ignore
      }
    }
    this.peerMap.clear()

    if (this.inputSource) {
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      this.inputSource = null
    }
    if (this.inputGain) {
      try {
        this.inputGain.disconnect()
      } catch {
        // ignore
      }
      this.inputGain = null
    }
    if (this.compressor) {
      try {
        this.compressor.disconnect()
      } catch {
        // ignore
      }
      this.compressor = null
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect()
      } catch {
        // ignore
      }
      this.analyser = null
    }
    if (this.masterGain) {
      try {
        this.masterGain.disconnect()
      } catch {
        // ignore
      }
      this.masterGain = null
    }
    if (this.destination) {
      this.destination.stream.getTracks().forEach((t) => t.stop())
      try {
        this.destination.disconnect()
      } catch {
        // ignore
      }
      this.destination = null
    }
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      void ctx.close().catch(() => {
        // ignore
      })
    }
    this.rawInputStream = null
    this.isDeafened = false
  }
}
