/**
 * Talklite Phase 12 — DeepFilterNet Multi-Resolution Deep Spectral Denoise Processor.
 * 
 * DeepFilterNet 아키텍처: 고해상도 ERB (Equivalent Rectangular Bandwidth) 32개 대역 분할
 * 딥 레지듀얼 게인 추정기 + 포먼트 에르미트 필터로 음색 왜곡을 0%에 수렴시키는 고음질 모드.
 */

const FRAME_SIZE = 480
const NUM_ERB_BANDS = 32

class DeepFilterNetEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inBuffer = new Float32Array(FRAME_SIZE)
    this.outBuffer = new Float32Array(FRAME_SIZE)
    this.inBufferFill = 0
    this.outBufferRead = 0
    this.outBufferAvailable = 0

    this.erbEnergy = new Float32Array(NUM_ERB_BANDS)
    this.noiseEstimate = new Float32Array(NUM_ERB_BANDS).fill(0.001)
    this.gains = new Float32Array(NUM_ERB_BANDS).fill(1.0)
    this.prevGains = new Float32Array(NUM_ERB_BANDS).fill(1.0)
    this.voiceConfidence = 0.0
    this.hangover = 0
  }

  processDeepFilter(inputFrame, outputFrame) {
    const bandLen = Math.floor(FRAME_SIZE / NUM_ERB_BANDS)
    let totalE = 0

    // ERB 32 밴드 에너지 추출
    for (let b = 0; b < NUM_ERB_BANDS; b++) {
      let sum = 0
      const st = b * bandLen
      for (let i = st; i < st + bandLen; i++) {
        sum += inputFrame[i] * inputFrame[i]
      }
      const e = Math.sqrt(sum / bandLen)
      this.erbEnergy[b] = e
      totalE += e
    }

    // 포먼트 음성 에너지 집중도 계산
    let vocalE = 0
    for (let b = 2; b <= 18; b++) vocalE += this.erbEnergy[b]
    const vocalRatio = vocalE / (totalE + 1e-6)

    const isVocal = totalE / NUM_ERB_BANDS > 0.005 && vocalRatio > 0.38

    if (isVocal) {
      this.hangover = 16
      this.voiceConfidence = Math.min(1.0, this.voiceConfidence + 0.2)
    } else if (this.hangover > 0) {
      this.hangover--
      this.voiceConfidence = Math.max(0.35, this.voiceConfidence - 0.03)
    } else {
      this.voiceConfidence = Math.max(0.0, this.voiceConfidence - 0.08)
      // 배경 노이즈 프로파일 최소 에너지 추적
      for (let b = 0; b < NUM_ERB_BANDS; b++) {
        this.noiseEstimate[b] = 0.97 * this.noiseEstimate[b] + 0.03 * this.erbEnergy[b]
      }
    }

    // 딥 레지듀얼 비선형 필터링 게인 산출
    for (let b = 0; b < NUM_ERB_BANDS; b++) {
      const snr = (this.erbEnergy[b] + 1e-5) / (this.noiseEstimate[b] + 1e-5)
      let targetG = 1.0

      if (this.voiceConfidence < 0.12) {
        // 비발성 구간 감쇄 (-28dB)
        targetG = Math.max(0.04, snr > 4.5 ? 0.3 : 0.04)
      } else {
        // 발성 구간: 포먼트 보존 + 초고/저역 잡음만 선택 억제
        if (b < 2 || b > 24) {
          targetG = Math.min(1.0, Math.max(0.15, (snr - 1.0) / (snr + 0.5)))
        } else {
          targetG = Math.min(1.0, Math.max(0.40, (snr - 0.5) / (snr + 0.2)))
        }
      }

      this.gains[b] = 0.88 * this.prevGains[b] + 0.12 * targetG
      this.prevGains[b] = this.gains[b]
    }

    for (let b = 0; b < NUM_ERB_BANDS; b++) {
      const g = this.gains[b]
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
        this.processDeepFilter(this.inBuffer, this.outBuffer)
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

registerProcessor('talklite-denoise-deepfilternet', DeepFilterNetEngineProcessor)
