/**
 * Web Audio API RMS 기반 발화자 감지 + VU 레벨 미터 (Phase 9).
 * 단일 AnalyserNode와 단일 rAF 루프로 발화 감지(hangover) 및 EMA 스무딩 VU 산출.
 * Engine의 AnalyserNode(fftSize 256, smoothing 0.8)를 공유하면 중복 AudioContext 없이 동작.
 * Standalone 모드(MediaStream 직접)도 지원 — 구호환 유지.
 */
export interface AudioDetectorOptions {
  threshold?: number
  hangoverMs?: number
  onTalkingChange: (talking: boolean) => void
  onVuLevel?: (level: number) => void
  analyser?: AnalyserNode | null
}

export class AudioDetector {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private externalAnalyser = false
  private raf = 0
  private talking = false
  private lastActive = 0
  private vuLevel = 0
  private lastVuTime = 0
  private lastVuEmit = 0
  private readonly threshold: number
  private readonly hangoverMs: number
  private readonly opts: AudioDetectorOptions

  // EMA constants
  private static readonly ATTACK_MS = 50
  private static readonly RELEASE_MS = 300

  constructor(opts: AudioDetectorOptions) {
    this.opts = opts
    this.threshold = opts.threshold ?? 0.02
    this.hangoverMs = opts.hangoverMs ?? 300
    if (opts.analyser) {
      this.analyser = opts.analyser
      this.externalAnalyser = true
    }
  }

  /** 외부 AnalyserNode 공유 모드로 시작 (Engine.getAnalyser() 전달) */
  startWithAnalyser(analyser: AnalyserNode): void {
    this.stop()
    this.analyser = analyser
    this.externalAnalyser = true
    this.talking = false
    this.vuLevel = 0
    this.lastVuTime = performance.now()
    this.lastVuEmit = 0
    this.lastActive = 0
    this.tick()
  }

  /** Legacy: MediaStream으로부터 자체 Context/Analyser 생성 (호환) */
  start(stream: MediaStream): void {
    if (this.analyser && this.externalAnalyser) {
      // 이미 외부 analyser로 동작 중이면 재사용
      if (this.raf === 0) this.tick()
      return
    }
    if (this.ctx) return
    const AudioCtor =
      window.AudioContext ||
      ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as
        | typeof AudioContext
        | undefined)
    if (!AudioCtor) return
    const ctx = new AudioCtor()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    this.ctx = ctx
    this.analyser = analyser
    this.externalAnalyser = false
    this.talking = false
    this.vuLevel = 0
    this.lastVuTime = performance.now()
    this.lastVuEmit = 0
    this.tick()
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (!this.externalAnalyser) {
      this.ctx?.close().catch(() => {
        // ignore
      })
      this.ctx = null
      this.analyser = null
    } else {
      // 외부 analyser는 닫지 않고 참조만 해제
      this.analyser = null
      this.externalAnalyser = false
    }
    this.talking = false
    // VU 리셋은 onVuLevel로 0 전달하여 외부 상태 동기화
    if (this.opts.onVuLevel) {
      try {
        this.opts.onVuLevel(0)
      } catch {
        // ignore
      }
    }
    this.vuLevel = 0
  }

  get isTalking(): boolean {
    return this.talking
  }

  get currentVuLevel(): number {
    return this.vuLevel
  }

  private tick = (): void => {
    const analyser = this.analyser
    if (!analyser) return
    const size = analyser.fftSize
    const data = new Float32Array(size)
    // externally shared analyser may be timeDomain or frequency? Use timeDomain for RMS
    analyser.getFloatTimeDomainData(data)

    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      sum += v * v
    }
    const rms = Math.sqrt(sum / data.length)
    const now = performance.now()

    // VU target: dB mapping -60~0 dB -> 0~1
    let vuTarget = 0
    if (rms > 0.0005) {
      const db = 20 * Math.log10(rms)
      vuTarget = Math.max(0, Math.min(1, (db + 60) / 60))
    } else {
      vuTarget = 0
    }
    // EMA smoothing Attack 50ms / Release 300ms
    const dt = Math.min(100, Math.max(0, now - this.lastVuTime))
    this.lastVuTime = now
    const tau = vuTarget > this.vuLevel ? AudioDetector.ATTACK_MS : AudioDetector.RELEASE_MS
    const alpha = dt > 0 ? 1 - Math.exp(-dt / tau) : vuTarget > this.vuLevel ? 0.3 : 0.05
    this.vuLevel += (vuTarget - this.vuLevel) * alpha
    // Throttle VU emit to ~30fps to avoid Zustand 60fps re-render storm
    if (this.opts.onVuLevel && now - this.lastVuEmit >= 32) {
      this.lastVuEmit = now
      try {
        this.opts.onVuLevel(this.vuLevel)
      } catch {
        // ignore
      }
    }

    // Talking detection
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
