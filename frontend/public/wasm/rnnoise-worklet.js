/**
 * Talklite Phase 12 — RNNoise 잡음 제거 AudioWorklet 프로세서 (WASM 로더 스텁).
 *
 * 실제 WASM 모듈(/wasm/rnnoise.wasm)을 AudioWorklet 스레드에서 fetch 후
 * WebAssembly.instantiateStreaming + arrayBuffer 2중 폴백으로 적재하고,
 * 128샘플 프레임을 480샘플(10ms @48kHz) 버퍼로 모아 RNNoise推론을 수행한다.
 * WASM 로드 실패 시 패스스루(fallback)로 동작하여 통화가 끊기지 않는다.
 */

const FRAME_SIZE = 480

class RnNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.wasm = null
    this.buffer = new Float32Array(FRAME_SIZE)
    this.bufferFill = 0
    this.ready = false
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'dispose') {
        this.wasm = null
        this.ready = false
      }
    }
    this.loadWasm().catch(() => {
      // Graceful: WASM 실패 시 패스스루 유지
      this.ready = false
    })
  }

  async loadWasm() {
    try {
      const res = await fetch('/wasm/rnnoise.wasm')
      if (!res.ok) throw new Error('wasm fetch failed')
      let bytes
      try {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
          const { instance } = await WebAssembly.instantiateStreaming(res)
          this.wasm = instance
          this.ready = true
          return
        }
      } catch {
        // streaming 실패 → arrayBuffer 폴백
      }
      bytes = await res.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(bytes)
      this.wasm = instance
      this.ready = true
    } catch {
      this.ready = false
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      if (output && output.length > 0) {
        for (let ch = 0; ch < output.length; ch++) output[ch].fill(0)
      }
      return true
    }
    const inCh = input[0]
    const outCh = output[0]
    if (!inCh) {
      outCh.fill(0)
      return true
    }

    if (!this.ready || !this.wasm) {
      // WASM 미적재 — 패스스루 (Graceful Fallback)
      outCh.set(inCh)
      return true
    }

    // 480샘플 버퍼링 후 추론(실제 RNNoise WASM 바인딩은 리파이너 단계에서 연결)
    for (let i = 0; i < inCh.length; i++) {
      this.buffer[this.bufferFill++] = inCh[i]
      if (this.bufferFill >= FRAME_SIZE) {
        this.bufferFill = 0
        // TODO(refiner): this.wasm.exports.rnnoise_process(this.buffer) 연동
      }
    }
    outCh.set(inCh)
    return true
  }
}

registerProcessor('talklite-denoise-rnnoise', RnNoiseProcessor)
