/**
 * Phase 12 — 플러그형 잡음 제거 엔진(AudioWorklet) 공용 베이스 및 온디맨드 로더.
 *
 * 파이프라인 위상 (VoiceAudioEngine 내부):
 *   inputSource ──► [denoiseGain(deprecated bypass) ] ─► inputGain ─► ...
 *
 *   실제 denoise 토폴로지:
 *     source ──► denoiseInput(gain) ──► AudioWorkletNode(model) ──► denoiseOutput(gain) ──► inputGain
 *     source ─────────────────────────────────────────────────────────► inputGain   (bypass 경로)
 *
 *   ON: denoiseInput/denoiseOutput 게인 5ms 크로스페이드로 1.0, bypass 게인 0.0
 *   OFF: 반대. Destination 노드는 불변이며 WebRTC 송신 트랙이 끊기지 않는다.
 */

import type { NoiseSuppressionModel } from './types'
import { FRAME_SIZE } from './types'

// 프레임 크기 단일 소스 재노출 (worklet 스텁과 공유 — 10ms @48kHz)
export { FRAME_SIZE }

export interface DenoiseEngineHandle {
  model: NoiseSuppressionModel
  node: AudioWorkletNode
  dispose(): void
}

/** worklet 프로세서 파일 URL (public/wasm/ 서빙) */
const WORKLET_URLS: Record<NoiseSuppressionModel, string> = {
  rnnoise: '/wasm/rnnoise-worklet.js',
  deepfilternet: '/wasm/deepfilternet-worklet.js',
  speex: '/wasm/speex-worklet.js',
}

/** 모듈별 로딩 중복 방지 (동일 AudioContext 기준) */
const workletLoaded = new WeakMap<AudioContext, Set<NoiseSuppressionModel>>()

/** 온디맨드 worklet 모듈 로딩 (중복 addModule 방지) */
export async function ensureWorkletModule(ctx: AudioContext, model: NoiseSuppressionModel): Promise<void> {
  let loaded = workletLoaded.get(ctx)
  if (!loaded) {
    loaded = new Set()
    workletLoaded.set(ctx, loaded)
  }
  if (loaded.has(model)) return
  await ctx.audioWorklet.addModule(WORKLET_URLS[model])
  loaded.add(model)
}

/**
 * 데노이즈 AudioWorkletNode 생성.
 * WASM 로딩 실패 등 예외는 상위(Gaceful Fallback)로 그대로 전파한다.
 */
export async function createDenoiseNode(ctx: AudioContext, model: NoiseSuppressionModel): Promise<AudioWorkletNode> {
  await ensureWorkletModule(ctx, model)
  const node = new AudioWorkletNode(ctx, `talklite-denoise-${model}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  return node
}

/** 5ms 선형 크로스페이드 (팝 노이즈 방어) */
export const CROSSFADE_SEC = 0.005

export function rampGain(gain: GainNode, ctx: AudioContext, to: number): void {
  const now = ctx.currentTime
  const param = gain.gain
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(to, now + CROSSFADE_SEC)
}

/** 엔진 핸들 정리 (disconnect + port 메시지 + port.close로 완전 해제) */
export function disposeHandle(handle: DenoiseEngineHandle | null): void {
  if (!handle) return
  try {
    handle.node.disconnect()
  } catch {
    // ignore
  }
  try {
    handle.node.port.postMessage({ type: 'dispose' })
  } catch {
    // ignore — 프로세서가 이미 종료된 경우
  }
  try {
    handle.node.port.close()
  } catch {
    // ignore — 이미 닫힌 경우
  }
}
