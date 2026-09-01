/**
 * Talklite Phase 12 — Speex DSP / Ultra-low CPU Stationary Noise Filter Processor.
 * 선풍기/에어컨 등 지속적인 백그라운드 험 노이즈를 초저부하로 컷오프하는 초절전 모드.
 */
const FRAME_SIZE = 480
const NUM_BANDS = 16

class SpeexProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inBuffer = new Float32Array(FRAME_SIZE)
    this.outBuffer = new Float32Array(FRAME_SIZE)
    this.inBufferFill = 0
    this.outBufferRead = 0
    this.outBufferAvailable = 0

    this.noiseFloor = new Float32Array(NUM_BANDS).fill(0.002)
    this.bandEnergy = new Float32Array(NUM_BANDS)
    this.smoothedGain = new Float32Array(NUM_BANDS).fill(1.0)
    this.speechProbability = 0
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
    const isVoice = avgEnergy > 0.007

    if (isVoice) {
      this.speechProbability = Math.min(1.0, this.speechProbability + 0.3)
    } else {
      this.speechProbability = Math.max(0.0, this.speechProbability - 0.2)
      for (let b = 0; b < NUM_BANDS; b++) {
        this.noiseFloor[b] = 0.95 * this.noiseFloor[b] + 0.05 * this.bandEnergy[b]
      }
    }

    for (let b = 0; b < NUM_BANDS; b++) {
      const snr = (this.bandEnergy[b] + 1e-6) / (this.noiseFloor[b] + 1e-6)
      let targetGain = this.speechProbability > 0.2 ? Math.min(1.0, Math.max(0.2, (snr - 1.0) / snr)) : 0.05
      this.smoothedGain[b] = 0.8 * this.smoothedGain[b] + 0.2 * targetGain
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

registerProcessor('talklite-denoise-speex', SpeexProcessor)
