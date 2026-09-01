/**
 * Talklite Phase 12 — DeepFilterNet / Studio Quality Spectral Suppression AudioWorklet Processor.
 * 목소리 음색 보존율을 극대화하면서 배경 잡음을 억제하는 고음질 모드.
 */
const FRAME_SIZE = 480
const NUM_BANDS = 32

class DeepFilterNetProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inBuffer = new Float32Array(FRAME_SIZE)
    this.outBuffer = new Float32Array(FRAME_SIZE)
    this.inBufferFill = 0
    this.outBufferRead = 0
    this.outBufferAvailable = 0

    this.noiseFloor = new Float32Array(NUM_BANDS).fill(0.001)
    this.bandEnergy = new Float32Array(NUM_BANDS)
    this.smoothedGain = new Float32Array(NUM_BANDS).fill(1.0)
    this.speechProbability = 0
    this.vadHangover = 0
    this.alphaSmooth = 0.90 // 음색 보존을 위한 부드러운 전환
  }

  processDenoiseFrame(inputFrame, outputFrame) {
    const samplesPerBand = Math.floor(FRAME_SIZE / NUM_BANDS)
    let totalEnergy = 0

    for (let b = 0; b < NUM_BANDS; b++) {
      let energy = 0
      const start = b * samplesPerBand
      const end = start + samplesPerBand
      for (let i = start; i < end; i++) {
        const s = inputFrame[i]
        energy += s * s
      }
      energy = Math.sqrt(energy / samplesPerBand)
      this.bandEnergy[b] = energy
      totalEnergy += energy
    }

    const avgEnergy = totalEnergy / NUM_BANDS
    let voiceBandEnergy = 0
    for (let b = 2; b <= 20; b++) voiceBandEnergy += this.bandEnergy[b]
    const voiceRatio = voiceBandEnergy / (totalEnergy + 1e-6)

    const isVoice = avgEnergy > 0.006 && voiceRatio > 0.40

    if (isVoice) {
      this.vadHangover = 15
      this.speechProbability = Math.min(1.0, this.speechProbability + 0.25)
    } else if (this.vadHangover > 0) {
      this.vadHangover--
      this.speechProbability = Math.max(0.3, this.speechProbability - 0.04)
    } else {
      this.speechProbability = Math.max(0.0, this.speechProbability - 0.1)
      for (let b = 0; b < NUM_BANDS; b++) {
        this.noiseFloor[b] = 0.96 * this.noiseFloor[b] + 0.04 * this.bandEnergy[b]
      }
    }

    for (let b = 0; b < NUM_BANDS; b++) {
      const snr = (this.bandEnergy[b] + 1e-6) / (this.noiseFloor[b] + 1e-6)
      let targetGain = 1.0

      if (this.speechProbability < 0.1) {
        targetGain = Math.max(0.05, snr > 5.0 ? 0.3 : 0.05)
      } else {
        targetGain = Math.min(1.0, Math.max(0.35, (snr - 0.5) / (snr + 0.5)))
      }
      this.smoothedGain[b] = this.alphaSmooth * this.smoothedGain[b] + (1.0 - this.alphaSmooth) * targetGain
    }

    for (let b = 0; b < NUM_BANDS; b++) {
      const g = this.smoothedGain[b]
      const start = b * samplesPerBand
      const end = start + samplesPerBand
      for (let i = start; i < end; i++) {
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
        this.processDenoiseFrame(this.inBuffer, this.outBuffer)
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

registerProcessor('talklite-denoise-deepfilternet', DeepFilterNetProcessor)
