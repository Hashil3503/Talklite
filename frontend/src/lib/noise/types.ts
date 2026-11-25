/** Phase 12 — 온디바이스 RNNoise 잡음 제거 피처 감지. */

/** 피처 감지: AudioWorklet + WebAssembly 지원 여부 (webkit + SecureContext 보강) */
export function isDenoiserSupported(): boolean {
  if (typeof window === 'undefined') return false
  // AudioWorklet은 Secure Context에서만 동작 (localhost 제외 시 미지원)
  if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) return false
  const hasWorklet = typeof AudioWorkletNode !== 'undefined'
  const hasWasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
  const AudioCtor =
    (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const hasWorkletLoader = !!AudioCtor && 'audioWorklet' in AudioCtor.prototype
  return hasWorklet && hasWasm && hasWorkletLoader
}
