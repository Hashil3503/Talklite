/**
 * Phase 12 — RNNoise(xiph, 학습된 가중치 내장 WASM) AudioWorklet 온디맨드 로더.
 * 파이프라인: source -> RnnoiseWorkletNode -> inputGain (OFF 시 source -> inputGain)
 */

import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

/** RNNoise는 48kHz로만 학습됨 */
const RNNOISE_SAMPLE_RATE = 48000

let modelPromise: Promise<ArrayBuffer> | null = null

/** 모델 다운로드 + 검증. worklet은 모델 로드 실패를 알리지 않고 무음이 되므로 여기서 먼저 컴파일해 확인한다. */
function loadModel(): Promise<ArrayBuffer> {
  modelPromise ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl })
    .then(async (binary) => {
      await WebAssembly.compile(binary)
      return binary
    })
    .catch((err: unknown) => {
      modelPromise = null // 다음 시도에서 다시 내려받는다
      throw err
    })
  return modelPromise
}

/** RNNoise 노드 생성. 실패 예외는 상위(Graceful Fallback)로 그대로 전파한다. */
export async function createDenoiseNode(ctx: AudioContext): Promise<RnnoiseWorkletNode> {
  if (ctx.sampleRate !== RNNOISE_SAMPLE_RATE) {
    throw new Error(`RNNoise requires ${RNNOISE_SAMPLE_RATE}Hz, got ${ctx.sampleRate}Hz`)
  }
  const [wasmBinary] = await Promise.all([loadModel(), ctx.audioWorklet.addModule(rnnoiseWorkletUrl)])
  return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
}

/** 노드 정리 (disconnect + WASM 상태 해제 + port 닫기) */
export function disposeDenoiseNode(node: RnnoiseWorkletNode | null): void {
  if (!node) return
  node.disconnect()
  node.destroy()
  node.port.close()
}
