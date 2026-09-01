/**
 * Phase 8 VoiceAudioEngine — Web Audio 기반 정밀 볼륨 제어 엔진.
 * 송신: rawMicStream -> Source -> [DenoiseWorklet(Phase 12, 옵션)] -> inputGain(0~2.0) -> DynamicsCompressor(-6dB 12:1) -> Destination
 * 수신: peer Stream -> Source -> peerGain(0~2.0) -> masterGain(0~1.0) -> AudioContext.destination
 *
 * Phase 12: setNoiseSuppression(enabled, model) — Destination 불변, denoiseSeq 시퀀스 가드,
 * 5ms 크로스페이드, WASM 로딩 실패 시 Graceful Fallback(바이패스).
 */

import { createDenoiseNode, disposeHandle, rampGain, type DenoiseEngineHandle } from './noise/denoiseEngine'
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

  // Phase 12 — denoise 파이프라인
  private denoiseHandle: DenoiseEngineHandle | null = null
  private denoiseInputGain: GainNode | null = null
  private denoiseBypassGain: GainNode | null = null
  private denoiseSeq = 0
  private noiseSuppressionEnabled = false
  private noiseSuppressionModel: NoiseSuppressionModel = 'rnnoise'

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const AudioCtor =
      window.AudioContext || ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext | undefined)
    if (!AudioCtor) throw new Error('Web Audio API not supported in this browser')
    const ctx = new AudioCtor()
    this.ctx = ctx

    // Input pipeline nodes (lazy — created without source)
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

    // Connect inputGain -> compressor -> destination (source connects later)
    // Analyser taps off inputGain in parallel (VU meter does not affect compressed stream)
    inputGain.connect(compressor)
    inputGain.connect(analyser)
    compressor.connect(destination)

    return ctx
  }

  initializeInput(rawStream: MediaStream): MediaStream {
    // If already initialized, clean previous source but keep nodes if context exists
    // For fresh session ensure context & nodes exist
    const ctx = this.ensureContext()
    this.rawInputStream = rawStream

    // Disconnect previous source if exists
    if (this.inputSource) {
      try {
        this.inputSource.disconnect()
      } catch {
        // ignore
      }
      this.inputSource = null
    }

    // (Re)create nodes if they were destroyed
    if (!this.inputGain || !this.compressor || !this.destination || !this.analyser) {
      // Should not happen if ctx existed but nodes cleared — recreate
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
      const dest = ctx.createMediaStreamDestination()
      this.destination = dest
      if (!this.analyser) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        this.analyser = analyser
      }
      const analyserNode = this.analyser!
      inputGain.connect(compressor)
      inputGain.connect(analyserNode)
      compressor.connect(dest)
      if (!this.masterGain) {
        const mg = ctx.createGain()
        mg.gain.value = this.isDeafened ? 0 : this.currentMasterVolume
        mg.connect(ctx.destination)
        this.masterGain = mg
        // Reconnect existing peers to new masterGain
        for (const peer of this.peerMap.values()) {
          try {
            peer.gain.disconnect()
          } catch {
            // ignore
          }
          peer.gain.connect(mg)
        }
      }
    }

    const source = ctx.createMediaStreamSource(rawStream)
    this.inputSource = source
    if (this.inputGain) {
      source.connect(this.inputGain)
    }

    // Return processed stream (destination stream)
    return this.destination ? this.destination.stream : rawStream
  }

  /** Phase 12 — 잡음 제거 활성 상태에 따라 새 Source를 올바른 게인에 재연결 */
  private rewireInputSource(source: MediaStreamAudioSourceNode): void {
    if (this.noiseSuppressionEnabled && this.denoiseHandle && this.denoiseInputGain && this.denoiseBypassGain && this.inputGain) {
      // Denoise 활성: source → denoiseInputGain(→worklet→inputGain) + source → bypassGain(→inputGain) 병렬
      try {
        source.connect(this.denoiseInputGain)
      } catch {
        // ignore
      }
      try {
        source.connect(this.denoiseBypassGain)
      } catch {
        // ignore
      }
    } else if (this.inputGain) {
      try {
        source.connect(this.inputGain)
      } catch {
        // ignore
      }
    }
  }

  replaceInput(newStream: MediaStream): MediaStream {
    if (!this.ctx || !this.inputGain || !this.destination) {
      // No context yet — fallback to initialize
      return this.initializeInput(newStream)
    }
    // Hot-swap: keep Destination & track, only replace Source
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

    const existing = this.peerMap.get(peerId)
    if (existing) {
      if (existing.stream === stream) return
      // Different stream for same peer — replace source
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
    // Default 1.0 — actual volume will be set via setPeerVolume after attach
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(master)
    this.peerMap.set(peerId, { source, gain, stream })
  }

  removeRemote(peerId: string): void {
    const entry = this.peerMap.get(peerId)
    if (!entry) return
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
    if (!this.masterGain) return
    if (value) {
      this.masterGain.gain.value = 0
    } else {
      this.masterGain.gain.value = this.storedMasterVolume
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
   * Phase 12 — 무단절 denoise 파이프라인 전환.
   * - Destination 노드 불변 (WebRTC 송신 트랙 유지)
   * - denoiseSeq 시퀀스 가드로 동시 전환 경합 방지 (마지막 요청만 유효)
   * - 5ms 크로스페이드 (팝 노이즈 방어)
   * - WASM/Worklet 로딩 실패 시 Graceful Fallback: 바이패스 유지, false 반환
   */
  private async applyNoiseSuppression(enabled: boolean, model: NoiseSuppressionModel): Promise<boolean> {
    if (!this.ctx || !this.inputSource || !this.inputGain) return false
    const ctx = this.ctx
    const seq = ++this.denoiseSeq

    this.noiseSuppressionModel = model

    // OFF (바이패스): 기존 노드는 유지하되 크로스페이드로 게인 전환 후 노드 해제
    if (!enabled) {
      this.noiseSuppressionEnabled = false
      this.crosfadeToBypass()
      // 시퀀스 가드: 최신 요청이 아니면 노드 정리를 미룬다 (dispose는 최종 책임)
      if (seq === this.denoiseSeq) {
        this.teardownDenoiseNodes()
      }
      return true
    }

    // ON: 엔진 노드 준비 (없거나 모델이 바뀐 경우에만 생성 → 핫스왑)
    try {
      const needsNewNode = !this.denoiseHandle || this.denoiseHandle.model !== model
      if (needsNewNode) {
        const oldHandle = this.denoiseHandle
        const node = await createDenoiseNode(ctx, model)
        // 시퀀스 가드: 로딩 중 다른 요청이 들어왔으면 새 노드 폐기하고 포기
        if (seq !== this.denoiseSeq) {
          disposeHandle({ model, node, dispose: () => {} })
          return false
        }
        if (oldHandle) {
          disposeHandle(oldHandle)
        }
        this.denoiseHandle = { model, node, dispose: () => disposeHandle({ model, node, dispose: () => {} }) }

        // 토폴로지: source -> denoiseInput -> worklet -> denoiseOutputGain -> inputGain
        if (!this.denoiseInputGain) {
          const dg = ctx.createGain()
          dg.gain.value = 0
          this.denoiseInputGain = dg
        }
        if (!this.denoiseBypassGain) {
          const bg = ctx.createGain()
          bg.gain.value = 1
          this.denoiseBypassGain = bg
          // bypass 경로: source -> bypassGain -> inputGain (최초 1회만 연결)
          this.inputSource.connect(bg)
          bg.connect(this.inputGain)
        }

        this.denoiseInputGain.disconnect()
        this.denoiseInputGain.connect(node)
        node.connect(this.inputGain)
        // denoise 경로 주입: source -> denoiseInput (bypassGain 연결은 유지)
        try {
          this.inputSource.disconnect(this.denoiseInputGain)
        } catch {
          // 미연결 상태 — 무시
        }
        this.inputSource.connect(this.denoiseInputGain)
      }

      this.noiseSuppressionEnabled = true
      this.crosfadeToDenoise()
      return true
    } catch (err) {
      // Graceful Fallback — WASM 로딩 실패 등: 통화 유지, 바이패스로 복귀
      console.error('[voice] noise suppression load failed, falling back to bypass:', err)
      if (seq === this.denoiseSeq) {
        this.noiseSuppressionEnabled = false
        this.crosfadeToBypass()
        this.teardownDenoiseNodes()
      }
      return false
    }
  }

  /** 5ms 크로스페이드: denoise 경로 ON / bypass OFF */
  private crosfadeToDenoise(): void {
    if (!this.ctx || !this.denoiseInputGain || !this.denoiseBypassGain) return
    rampGain(this.denoiseInputGain, this.ctx, 1)
    rampGain(this.denoiseBypassGain, this.ctx, 0)
  }

  /** 5ms 크로스페이드: bypass ON / denoise OFF */
  private crosfadeToBypass(): void {
    if (!this.ctx || !this.denoiseInputGain || !this.denoiseBypassGain) return
    rampGain(this.denoiseBypassGain, this.ctx, 1)
    rampGain(this.denoiseInputGain, this.ctx, 0)
  }

  /** denoise 전용 노드 연결 해제 (bypassGain은 유지 — 재활용) */
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
    if (this.denoiseInputGain) {
      try {
        this.denoiseInputGain.disconnect()
      } catch {
        // ignore
      }
    }
  }

  getNoiseSuppressionState(): { enabled: boolean; model: NoiseSuppressionModel } {
    return { enabled: this.noiseSuppressionEnabled, model: this.noiseSuppressionModel }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  destroy(): void {
    // Phase 12 — AudioContext를 닫기 전에 denoise 노드부터 정리 (port/Worklet 누수 방어)
    this.teardownDenoiseNodes()
    this.denoiseBypassGain = null
    this.denoiseInputGain = null
    this.noiseSuppressionEnabled = false
    this.denoiseSeq++

    // Disconnect & clear peer outputs
    for (const [, entry] of this.peerMap) {
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
      // Stop destination tracks
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
        // ignore close failure
      })
    }
    this.rawInputStream = null
    this.isDeafened = false
  }
}
