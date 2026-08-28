/**
 * Phase 8 VoiceAudioEngine — Web Audio 기반 정밀 볼륨 제어 엔진.
 * 송신: rawMicStream -> Source -> inputGain(0~2.0) -> DynamicsCompressor(-6dB 12:1) -> Destination
 * 수신: peer Stream -> Source -> peerGain(0~2.0) -> masterGain(0~1.0) -> AudioContext.destination
 */

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
    source.connect(this.inputGain)
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

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  destroy(): void {
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
