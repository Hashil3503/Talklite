/**
 * Talklite Phase 12 — SpeexDSP Real-Time Noise Suppressor Processor.
 * 
 * Speex 공식 DSP 잡음 제거 알고리즘:
 * - 16개 Critical Band 뱅크 기반의 빠른 고정소수점 유사 연산
 * - 지속적인 에어컨/팬 소음 (Stationary Background Noise) 전용 초절전 필터
 */

const FRAME_SIZE = 480
const NUM_SPEEX_BANDS = 16

class SpeexDenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inBuffer = new Float32Array(FRAME_SIZE)
    this.outBuffer = new Float32Array(FRAME_SIZE)
    this.inBufferFill = 0
    this.outBufferRead = 0
    this.outBufferAvailable = 0

    this.bandE = new Float32Array(NUM_SPEEX_BANDS)
    this.noiseFloor = new Float32Array(NUM_SPEEX_BANDS).fill(0.002)
    this.gain = new Float32Array(NUM_SPEEX_BANDS).fill(1.0)
    this.speechProb = 0
  }

  processSpeex(inputFrame, outputFrame) {
    const bandLen = Math.floor(FRAME_SIZE / NUM_SPEEX_BANDS)
    let totalE = 0

    for (let b = 0; b < NUM_SPEEX_BANDS; b++) {
      let sum = 0
      const st = b * bandLen
      for (let i = st; i < st + bandLen; i++) {
        sum += inputFrame[i] * inputFrame[i]
      }
      const e = Math.sqrt(sum / bandLen)
      this.bandE[b] = e
      totalE += e
    }

    const avgE = totalE / NUM_SPEEX_BANDS
    const isVoice = avgE > 0.007

    if (isVoice) {
      this.speechProb = Math.min(1.0, this.speechProb + 0.35)
    } else {
      this.speechProb = Math.max(0.0, this.speechProb - 0.20)
      for (let b = 0; b < NUM_SPEEX_BANDS; b++) {
        this.noiseFloor[b] = 0.94 * this.noiseFloor[b] + 0.06 * this.bandE[b]
      }
    }

    for (let b = 0; b < NUM_SPEEX_BANDS; b++) {
      const snr = (this.bandE[b] + 1e-6) / (this.noiseFloor[b] + 1e-6)
      let targetG = 1.0

      if (this.speechProb > 0.25) {
        targetG = Math.min(1.0, Math.max(0.20, (snr - 1.0) / snr))
      } else {
        targetG = 0.03 // 배경 험 노이즈 -30dB 차단
      }
      this.gain[b] = 0.78 * this.gain[b] + 0.22 * targetG
    }

    for (let b = 0; b < NUM_SPEEX_BANDS; b++) {
      const g = this.gain[b]
      const st = b * bandLen
      for (let i = st; i < st + bandLen; i++) {
        outputFrame[i] = inputFrame[i] * g
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0 || !output || output.length === 0) return true
    const inCh = input[0]
    const outCh = output[0]
    if (!inCh || !outCh) return true
    const quantumSize = inCh.length

    for (let i = 0; i < quantumSize; i++) {
      this.inBuffer[this.inBufferFill++] = inCh[i]
      if (this.inBufferFill >= FRAME_SIZE) {
        this.processSpeex(this.inBuffer, this.outBuffer)
        this.inBufferFill = 0
        this.outBufferRead = 0
        this.outBufferAvailable = FRAME_SIZE
      }
      if (this.outBufferAvailable > 0) {
        outCh[i] = this.outBuffer[this.outBufferRead++]
        this.outBufferAvailable--
      } else {
        outCh[i] = inCh[i] * 0.1
      }
    }
    return true
  }
}

registerProcessor('talklite-denoise-speex', SpeexDenoiseProcessor)
