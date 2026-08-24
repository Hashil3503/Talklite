/**
 * Web Audio API RMS 기반 발화자 감지 (FR-VOICE-03, T-05).
 * AnalyserNode 신호 RMS 계산 + 하강 히스테리시스(Hangover)로 경계값 부근 플리커 방지.
 * 상태 전이(silent→talking / talking→silent) 시에만 onTalkingChange 콜백 호출.
 */
export interface AudioDetectorOptions {
  threshold?: number
  hangoverMs?: number
  onTalkingChange: (talking: boolean) => void
}

export class AudioDetector {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private raf = 0
  private talking = false
  private lastActive = 0
  private readonly threshold: number
  private readonly hangoverMs: number
  private readonly opts: AudioDetectorOptions

  constructor(opts: AudioDetectorOptions) {
    this.opts = opts
    this.threshold = opts.threshold ?? 0.02
    this.hangoverMs = opts.hangoverMs ?? 300
  }

  start(stream: MediaStream): void {
    if (this.ctx) return
    const AudioCtor = window.AudioContext
    if (!AudioCtor) return
    const ctx = new AudioCtor()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    analyser.connect(ctx.destination)
    this.ctx = ctx
    this.analyser = analyser
    this.talking = false
    this.tick()
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.ctx?.close().catch(() => {
      // AudioContext 종료 실패는 무시
    })
    this.ctx = null
    this.analyser = null
    this.talking = false
  }

  get isTalking(): boolean {
    return this.talking
  }

  private tick = (): void => {
    const ctx = this.ctx
    const analyser = this.analyser
    if (!ctx || !analyser) return
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)

    let sum = 0
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i]
    }
    const rms = Math.sqrt(sum / data.length)
    const now = performance.now()

    if (rms > this.threshold) {
      this.lastActive = now
      if (!this.talking) {
        this.talking = true
        this.opts.onTalkingChange(true)
      }
    } else if (this.talking && now - this.lastActive > this.hangoverMs) {
      this.talking = false
      this.opts.onTalkingChange(false)
    }

    this.raf = requestAnimationFrame(this.tick)
  }
}
