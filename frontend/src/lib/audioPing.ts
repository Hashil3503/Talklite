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
