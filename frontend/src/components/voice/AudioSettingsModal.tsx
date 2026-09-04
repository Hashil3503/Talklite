import React, { useEffect, useState } from 'react'
import { useVoiceStore } from '../../store/voiceStore'
import { NOISE_MODEL_META, type NoiseSuppressionModel } from '../../lib/noise/types'
import { VuMeter } from './VuMeter'

interface AudioSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({ isOpen, onClose }) => {
  const inputGain = useVoiceStore((state) => state.inputGain)
  const masterVolume = useVoiceStore((state) => state.masterVolume)
  const inputMode = useVoiceStore((state) => state.inputMode)
  const pttKey = useVoiceStore((state) => state.pttKey)
  const isTestingMic = useVoiceStore((state) => state.isTestingMic)
  const isNoiseSuppressionEnabled = useVoiceStore((state) => state.isNoiseSuppressionEnabled)
  const noiseSuppressionModel = useVoiceStore((state) => state.noiseSuppressionModel)
  const isNoiseLoading = useVoiceStore((state) => state.isNoiseLoading)
  const noiseError = useVoiceStore((state) => state.noiseError)
  const isDenoiserSupported = useVoiceStore((state) => state.isDenoiserSupported)

  const setInputGain = useVoiceStore((state) => state.setInputGain)
  const setMasterVolume = useVoiceStore((state) => state.setMasterVolume)
  const setInputMode = useVoiceStore((state) => state.setInputMode)
  const setPttKey = useVoiceStore((state) => state.setPttKey)
  const startMicTest = useVoiceStore((state) => state.startMicTest)
  const stopMicTest = useVoiceStore((state) => state.stopMicTest)
  const setNoiseSuppression = useVoiceStore((state) => state.setNoiseSuppression)
  const setNoiseSuppressionModel = useVoiceStore((state) => state.setNoiseSuppressionModel)

  const [isCapturing, setIsCapturing] = useState(false)

  // 모달 닫힘 시 테스트 스트림 안전 해제 (P1-06: stopMicTest 트랙 stop + URL revoke)
  useEffect(() => {
    if (!isOpen) return
    return () => {
      setIsCapturing(false)
      useVoiceStore.getState().stopMicTest()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isCapturing) return
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code) {
        setPttKey(e.code)
        setIsCapturing(false)
      }
    }
    const onBlur = (): void => setIsCapturing(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [isCapturing, setPttKey])

  if (!isOpen) return null

  const inputPercent = Math.round(inputGain * 100)
  const masterPercent = Math.round(masterVolume * 100)

  const formatPttKey = (code: string): string => {
    if (code === 'Space') return 'Space'
    if (code.startsWith('Key')) return code.slice(3)
    if (code.startsWith('Digit')) return code.slice(5)
    return code
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-settings-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[#171720] p-6 shadow-2xl space-y-5 max-h-[88vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 id="audio-settings-modal-title" className="text-base font-bold text-white flex items-center gap-2">
            ⚙️ 오디오 설정
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors" aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 입력 게인 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">마이크 입력 게인</span>
            <span className="text-xs font-mono text-[#10B981]">{inputPercent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={inputPercent}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (!Number.isFinite(next)) return
              setInputGain(next / 100)
            }}
            aria-label="마이크 입력 게인"
            aria-valuemin={0}
            aria-valuemax={200}
            aria-valuenow={inputPercent}
            aria-valuetext={`${inputPercent}%`}
            className="w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
            <span>0%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>

        {/* 마스터 볼륨 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">마스터 볼륨</span>
            <span className="text-xs font-mono text-[#50C2F3]">{masterPercent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={masterPercent}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (!Number.isFinite(next)) return
              setMasterVolume(next / 100)
            }}
            aria-label="마스터 볼륨"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={masterPercent}
            aria-valuetext={`${masterPercent}%`}
            className="w-full accent-cyan-400"
          />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* VU + 3초 루프백 테스트 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">VU 레벨</span>
            <span className="text-[10px] text-zinc-500">20단계</span>
          </div>
          <VuMeter size="sm" />
          <button
            onClick={() => {
              if (isTestingMic) void stopMicTest()
              else void startMicTest()
            }}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              isTestingMic
                ? 'bg-amber-900/60 text-amber-200 border border-amber-700'
                : 'bg-[#0B0B0E] hover:bg-[#121217] text-zinc-300 border border-[rgba(255,255,255,0.1)]'
            }`}
          >
            {isTestingMic ? '⏹️ 테스트 중지 (3초 녹음·재생)' : '🎤 3초 마이크 테스트'}
          </button>
        </div>

        {/* 입력 모드 */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0B0B0E]/60 p-2">
          <div className="mb-1 text-xs font-semibold text-zinc-300">입력 모드</div>
          <div className="flex gap-1">
            <button
              onClick={() => setInputMode('voice_activity')}
              aria-pressed={inputMode === 'voice_activity'}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                inputMode === 'voice_activity' ? 'bg-[#10B981] text-black' : 'bg-[#121217] text-zinc-400 hover:bg-[#171720]'
              }`}
            >
              음성 감지
            </button>
            <button
              onClick={() => setInputMode('push_to_talk')}
              aria-pressed={inputMode === 'push_to_talk'}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                inputMode === 'push_to_talk' ? 'bg-[#50C2F3] text-black' : 'bg-[#121217] text-zinc-400 hover:bg-[#171720]'
              }`}
            >
              PTT
            </button>
          </div>
          {inputMode === 'push_to_talk' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-zinc-400">단축키:</span>
              <span className="rounded bg-[#0B0B0E] px-2 py-1 text-xs font-mono text-[#50C2F3] border border-[rgba(255,255,255,0.1)]">
                {formatPttKey(pttKey)}
              </span>
              <button
                onClick={() => setIsCapturing((v) => !v)}
                className={`ml-auto rounded px-2 py-1 text-xs font-semibold border transition-colors ${
                  isCapturing
                    ? 'bg-amber-900/60 text-amber-200 border-amber-700'
                    : 'bg-[#121217] text-zinc-300 border-[rgba(255,255,255,0.1)] hover:bg-[#171720]'
                }`}
              >
                {isCapturing ? '키 입력 대기...' : '변경'}
              </button>
            </div>
          )}
        </div>

        {/* AI 딥러닝 잡음 제거 */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0B0B0E]/60 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">AI 잡음 제거</span>
            {!isDenoiserSupported && (
              <span title="이 브라우저는 AudioWorklet/WASM을 지원하지 않습니다" className="text-[10px] text-zinc-500">
                미지원 브라우저
              </span>
            )}
            {isNoiseLoading && (
              <span aria-busy="true" className="text-[10px] text-amber-300">
                ⏳ 로딩 중...
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span id="talklite-noise-label" className="text-xs text-zinc-400">
              딥러닝 잡음 제거 사용
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={isNoiseSuppressionEnabled}
              aria-labelledby="talklite-noise-label"
              disabled={!isDenoiserSupported || isNoiseLoading}
              onClick={() => void setNoiseSuppression(!isNoiseSuppressionEnabled)}
              className={`relative h-5 w-10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                isNoiseSuppressionEnabled ? 'bg-[#10B981]' : 'bg-zinc-700'
              } ${!isDenoiserSupported || isNoiseLoading ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  isNoiseSuppressionEnabled ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          {isDenoiserSupported && isNoiseSuppressionEnabled && (
            <div className="mt-2 space-y-1" role="radiogroup" aria-label="잡음 제거 엔진 선택">
              {(Object.keys(NOISE_MODEL_META) as NoiseSuppressionModel[]).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-start gap-2 rounded-md p-1.5 transition-colors ${
                    noiseSuppressionModel === m ? 'bg-emerald-950/60 border border-emerald-800' : 'hover:bg-[#121217] border border-transparent'
                  } ${isNoiseLoading ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="talklite-noise-model"
                    value={m}
                    checked={noiseSuppressionModel === m}
                    disabled={isNoiseLoading}
                    onChange={() => void setNoiseSuppressionModel(m)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-200">{NOISE_MODEL_META[m].label}</span>
                    <span className="block text-[10px] leading-tight text-zinc-500">{NOISE_MODEL_META[m].description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {noiseError && <p className="mt-1 text-[10px] leading-tight text-amber-400">{noiseError}</p>}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-[#121217] hover:bg-[#0B0B0E] text-sm font-semibold text-zinc-200 border border-[rgba(255,255,255,0.1)] transition-colors"
        >
          닫기
        </button>
      </div>
    </div>
  )
}