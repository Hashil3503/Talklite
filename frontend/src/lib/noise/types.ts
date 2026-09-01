/**
 * Phase 12 — 온디바이스 플러그형 실시간 잡음 제거 시스템 공통 타입 및 피처 감지.
 * 3종 엔진: RNNoise(게이밍) / DeepFilterNet(스튜디오) / Speex(초절전)
 */

export type NoiseSuppressionModel = 'deepfilternet' | 'speex'

export const NOISE_SUPPRESSION_MODELS: readonly NoiseSuppressionModel[] = ['deepfilternet', 'speex'] as const

export const NOISE_MODEL_META: Record<NoiseSuppressionModel, { label: string; description: string }> = {
  deepfilternet: { label: 'DeepFilterNet (권장)', description: '스튜디오 음질 · 음색 보존 · 실시간 잡음 제거' },
  speex: { label: 'Speex DSP (초절전)', description: '선풍기/에어컨/팬 소음 전용 초저부하 필터' },
}

/** 화이트리스트 검증: localStorage 등 외부 입력에서 안전하게 모델 복원 */
export function isNoiseSuppressionModel(value: unknown): value is NoiseSuppressionModel {
  return typeof value === 'string' && (NOISE_SUPPRESSION_MODELS as readonly string[]).includes(value)
}

/** 공용 프레임 크기 (10ms @48kHz) — worklet 스텁과 단일 소스 */
export const FRAME_SIZE = 480
export const DENOISE_FRAME_SIZE = FRAME_SIZE

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
