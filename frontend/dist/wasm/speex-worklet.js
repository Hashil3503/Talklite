/**
 * Talklite Phase 12 — Speex DSP 잡음 제거 AudioWorklet 프로세서 (WASM 로더 스텁).
 * 초절전(저CPU) 지속 노이즈 제거 엔진. WASM 실패 시 패스스루.
 */

const FRAME_SIZE = 480

class SpeexProcessor extends AudioWorkletProcessor {
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
      this.ready = false
    })
  }

  async loadWasm() {
    try {
      const res = await fetch('/wasm/speex.wasm')
      if (!res.ok) throw new Error('wasm fetch failed')
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
      const bytes = await res.arrayBuffer()
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
      outCh.set(inCh)
      return true
    }
    for (let i = 0; i < inCh.length; i++) {
      this.buffer[this.bufferFill++] = inCh[i]
      if (this.bufferFill >= FRAME_SIZE) {
        this.bufferFill = 0
        // TODO(refiner): this.wasm.exports.speex_preprocess(this.buffer) 연동
      }
    }
    outCh.set(inCh)
    return true
  }
}

registerProcessor('talklite-denoise-speex', SpeexProcessor)
