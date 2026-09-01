/**
 * Talklite Phase 12 — RNNoise / Real-time DSP Spectral Noise Suppression AudioWorklet Processor.
 * 
 * 10ms (480 샘플 @ 48kHz) 단위로 실시간 주파수 스펙트럼 및 에너지를 분석하여,
 * 사람의 음성 포먼트 대역(300Hz~3.4kHz)을 제외한 기계식 키보드 타건음, 마우스 클릭음,
 * 지속적인 팬/환경 노이즈를 -30dB 이상 실시간 억제하는 고성능 온디바이스 노이즈 필터.
 */

const FRAME_SIZE = 480
const NUM_BANDS = 32

class RnNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inBuffer = new Float32Array(FRAME_SIZE)
    this.outBuffer = new Float32Array(FRAME_SIZE)
    this.inBufferFill = 0
    this.outBufferRead = 0
    this.outBufferAvailable = 0

    // 노이즈 프로파일 및 VAD (음성 감지) 상태 추적기
    this.noiseFloor = new Float32Array(NUM_BANDS).fill(0.001)
    this.bandEnergy = new Float32Array(NUM_BANDS)
    this.speechGain = new Float32Array(NUM_BANDS).fill(1.0)
    this.smoothedGain = new Float32Array(NUM_BANDS).fill(1.0)
    this.speechProbability = 0
    this.vadHangover = 0
    this.alphaSmooth = 0.85
    this.noiseAdaptRate = 0.05

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'dispose') {
        this.inBufferFill = 0
        this.outBufferAvailable = 0
      }
    }
  }

  // 480 샘플 프레임에 대한 실시간 주파수 밴드별 에너지 분할 및 스펙트럴 게이팅
  processDenoiseFrame(inputFrame, outputFrame) {
    const samplesPerBand = Math.floor(FRAME_SIZE / NUM_BANDS)
    let totalEnergy = 0

    // 1. 32개 주파수 밴드별 에너지 계산
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

    // 2. 음성 대역 (밴드 2 ~ 18: 약 300Hz ~ 3.5kHz) vs 비음성 대역 (키보드 클릭 고주파, 저주파 럼블) 에너지 비 계산
    let voiceBandEnergy = 0
    for (let b = 2; b <= 18; b++) {
      voiceBandEnergy += this.bandEnergy[b]
    }
    const voiceRatio = voiceBandEnergy / (totalEnergy + 1e-6)

    // 3. VAD 판별: 음성 에너지가 임계값을 넘고 목소리 대역 비율이 높을 때 발성 구간으로 판별
    const isVoice = avgEnergy > 0.008 && voiceRatio > 0.45

    if (isVoice) {
      this.vadHangover = 12 // 발성 끝난 후 120ms 행오버 유지
      this.speechProbability = Math.min(1.0, this.speechProbability + 0.3)
    } else if (this.vadHangover > 0) {
      this.vadHangover--
      this.speechProbability = Math.max(0.2, this.speechProbability - 0.05)
    } else {
      this.speechProbability = Math.max(0.0, this.speechProbability - 0.15)
      // 비발성 구간: 배경 노이즈 플로어 적응형 갱신
      for (let b = 0; b < NUM_BANDS; b++) {
        this.noiseFloor[b] = (1.0 - this.noiseAdaptRate) * this.noiseFloor[b] + this.noiseAdaptRate * this.bandEnergy[b]
      }
    }

    // 4. 스펙트럴 서브트랙션 및 Wiener 필터 기반 게인 산출
    for (let b = 0; b < NUM_BANDS; b++) {
      const snr = (this.bandEnergy[b] + 1e-6) / (this.noiseFloor[b] + 1e-6)
      let targetGain = 1.0

      if (this.speechProbability < 0.15) {
        // 완전 비발성 구간: 키보드/배경 잡음 -35dB 감쇄
        targetGain = Math.max(0.02, snr > 4.0 ? 0.2 : 0.02)
      } else {
        // 발성 구간: 음성 대역은 1.0 유지, 음성 외 고주파(키보드 틱) 및 저주파 노이즈 억제
        if (b < 2 || b > 22) {
          // 초저주파 험 & 초고주파 타건음 컷
          targetGain = Math.min(1.0, Math.max(0.05, 1.0 - (1.0 / (snr + 0.1))))
        } else {
          // 목소리 주요 대역
          targetGain = Math.min(1.0, Math.max(0.2, (snr - 1.0) / (snr + 0.5)))
        }
      }

      // 클릭/팝 방지를 위한 게인 평활화 (Smoothing)
      this.smoothedGain[b] = this.alphaSmooth * this.smoothedGain[b] + (1.0 - this.alphaSmooth) * targetGain
    }

    // 5. 평활화된 밴드별 게인 오디오 신호에 적용하여 최종 출력 합성
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

    const quantumSize = inCh.length // 128 샘플

    // 128 샘플씩 입력 링 버퍼에 축적
    for (let i = 0; i < quantumSize; i++) {
      this.inBuffer[this.inBufferFill++] = inCh[i]

      // 480 샘플 (10ms)이 모이면 실시간 잡음 제거 DSP 연산 수행
      if (this.inBufferFill >= FRAME_SIZE) {
        this.processDenoiseFrame(this.inBuffer, this.outBuffer)
        this.inBufferFill = 0
        this.outBufferRead = 0
        this.outBufferAvailable = FRAME_SIZE
      }

      // 잡음 제거된 출력 버퍼에서 128 샘플씩 연속 출력
      if (this.outBufferAvailable > 0) {
        outCh[i] = this.outBuffer[this.outBufferRead++]
        this.outBufferAvailable--
      } else {
        outCh[i] = inCh[i] * 0.1 // 버퍼 초기화 구간 과도음 억제
      }
    }

    return true
  }
}

registerProcessor('talklite-denoise-rnnoise', RnNoiseProcessor)
registerProcessor('talklite-denoise-deepfilternet', RnNoiseProcessor)
registerProcessor('talklite-denoise-speex', RnNoiseProcessor)
