let ctx: AudioContext | null = null
let lastPing = 0

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  try {
    const CtxClass: typeof AudioContext = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext
    ctx = new CtxClass()
    return ctx
  } catch {
    return null
  }
}

/** 무에셋 합성 톤 — 짧은 어택/릴리즈를 가진 sine 오실레이터 1개를 오프셋 시각에 예약 */
function scheduleTone(ctx: AudioContext, freq: number, startOffset: number, duration: number, volume: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const start = ctx.currentTime + startOffset
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  const attack = 0.01
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
  // GC after stop
  setTimeout(() => {
    try {
      osc.disconnect()
      gain.disconnect()
    } catch {}
  }, Math.max(200, (startOffset + duration + 0.05) * 1000))
}

/** 디스코드 참여 느낌 — 낮은 주파수에서 올라가는 두 단계 톤 (523Hz → 784Hz) */
export async function playVoiceJoinSound(): Promise<void> {
  const audioCtx = ensureContext()
  if (!audioCtx) return
  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    if (audioCtx.state !== 'running') return
    scheduleTone(audioCtx, 523, 0, 0.08, 0.22)
    scheduleTone(audioCtx, 784, 0.1, 0.12, 0.22)
  } catch {}
}

/** 디스코드 종료 느낌 — 높은 주파수에서 내려가는 두 단계 톤 (784Hz → 523Hz) */
export async function playVoiceLeaveSound(): Promise<void> {
  const audioCtx = ensureContext()
  if (!audioCtx) return
  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    if (audioCtx.state !== 'running') return
    scheduleTone(audioCtx, 784, 0, 0.08, 0.22)
    scheduleTone(audioCtx, 523, 0.1, 0.12, 0.22)
  } catch {}
}

/**
 * Web Audio 무에셋 핑: 880Hz -> 1760Hz sine 100ms + 500ms 디바운스
 * 내가 보낸 메시지는 store에서 걸러짐. 500ms 내 중복 호출은 무시.
 */
export async function playMentionPing(): Promise<void> {
  const now = Date.now()
  if (now - lastPing < 500) return
  lastPing = now

  const audioCtx = ensureContext()
  if (!audioCtx) return
  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    if (audioCtx.state !== 'running') return

    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, audioCtx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.28, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.12)
    // GC after stop
    setTimeout(() => {
      try {
        osc.disconnect()
        gain.disconnect()
      } catch {}
    }, 200)
  } catch {}
}
