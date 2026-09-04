import React, { useEffect, useRef, useState } from 'react'
import { useVoiceStore, getUid, cleanDeviceLabel } from '../../store/voiceStore'
import { NOISE_MODEL_META, type NoiseSuppressionModel } from '../../lib/noise/types'

const VuMeter: React.FC = () => {
  const meterRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let previousLevel = -1
    const update = (level: number): void => {
      const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
      if (normalized === previousLevel) return
      previousLevel = normalized
      const percent = `${Math.round(normalized * 100)}%`
      fillRef.current?.style.setProperty('width', percent)
      meterRef.current?.setAttribute('aria-valuenow', String(Math.round(normalized * 100)))
      meterRef.current?.setAttribute('aria-valuetext', percent)
    }

    update(useVoiceStore.getState().micVolumeLevel)
    return useVoiceStore.subscribe((state) => update(state.micVolumeLevel))
  }, [])

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">VU 레벨</span>
      </div>
      <div
        ref={meterRef}
        role="meter"
        aria-label="마이크 VU 레벨"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext="0%"
        className="h-2 w-full overflow-hidden rounded-sm bg-zinc-800"
      >
        <div ref={fillRef} className="h-full w-0 rounded-sm bg-emerald-500 transition-[width] duration-75" />
      </div>
    </div>
  )
}

export const VoiceBar: React.FC<{ roomId: string }> = ({ roomId }) => {
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const isMuted = useVoiceStore((state) => state.isMuted)
  const isDeafened = useVoiceStore((state) => state.isDeafened)
  const voiceMembers = useVoiceStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const inputDevices = useVoiceStore((state) => state.inputDevices)
  const outputDevices = useVoiceStore((state) => state.outputDevices)
  const selectedSpeakerDeviceId = useVoiceStore((state) => state.selectedSpeakerDeviceId)
  const canSelectOutput = useVoiceStore((state) => state.canSelectOutput)
  const isOutputChanging = useVoiceStore((state) => state.isOutputChanging)
  const outputRouteState = useVoiceStore((state) => state.outputRouteState)
  const outputError = useVoiceStore((state) => state.outputError)
  const error = useVoiceStore((state) => state.error)
  const isAudioAutoplayBlocked = useVoiceStore((state) => state.isAudioAutoplayBlocked)
  const inputGain = useVoiceStore((state) => state.inputGain)
  const masterVolume = useVoiceStore((state) => state.masterVolume)
  const inputMode = useVoiceStore((state) => state.inputMode)
  const pttKey = useVoiceStore((state) => state.pttKey)
  const isPttActive = useVoiceStore((state) => state.isPttActive)
  const isTestingMic = useVoiceStore((state) => state.isTestingMic)
  const isNoiseSuppressionEnabled = useVoiceStore((state) => state.isNoiseSuppressionEnabled)
  const noiseSuppressionModel = useVoiceStore((state) => state.noiseSuppressionModel)
  const isNoiseLoading = useVoiceStore((state) => state.isNoiseLoading)
  const noiseError = useVoiceStore((state) => state.noiseError)
  const isDenoiserSupported = useVoiceStore((state) => state.isDenoiserSupported)
  const selectedAudioDeviceId = useVoiceStore((state) => state.selectedAudioDeviceId)
  const joinVoice = useVoiceStore((state) => state.joinVoice)
  const leaveVoice = useVoiceStore((state) => state.leaveVoice)
  const toggleMute = useVoiceStore((state) => state.toggleMute)
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen)
  const setDevice = useVoiceStore((state) => state.setDevice)
  const setOutputDevice = useVoiceStore((state) => state.setOutputDevice)
  const unlockAudio = useVoiceStore((state) => state.unlockAudio)
  const setInputGain = useVoiceStore((state) => state.setInputGain)
  const setMasterVolume = useVoiceStore((state) => state.setMasterVolume)
  const setInputMode = useVoiceStore((state) => state.setInputMode)
  const setPttKey = useVoiceStore((state) => state.setPttKey)
  const startMicTest = useVoiceStore((state) => state.startMicTest)
  const stopMicTest = useVoiceStore((state) => state.stopMicTest)
  const setNoiseSuppression = useVoiceStore((state) => state.setNoiseSuppression)
  const setNoiseSuppressionModel = useVoiceStore((state) => state.setNoiseSuppressionModel)

  const [showInput, setShowInput] = useState(false)
  const [showMaster, setShowMaster] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)
  const masterRef = useRef<HTMLDivElement>(null)

  const me = getUid()
  const meTalking = !!speaking[me]
  const inputPercent = Math.round(inputGain * 100)
  const masterPercent = Math.round(masterVolume * 100)
  useEffect(() => {
    if (!showInput && !showMaster) return
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (showInput && inputRef.current && !inputRef.current.contains(target)) setShowInput(false)
      if (showMaster && masterRef.current && !masterRef.current.contains(target)) setShowMaster(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setShowInput(false)
        setShowMaster(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [showInput, showMaster])

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

  const formatPttKey = (code: string): string => {
    if (code === 'Space') return 'Space'
    if (code.startsWith('Key')) return code.slice(3)
    if (code.startsWith('Digit')) return code.slice(5)
    return code
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
      {isAudioAutoplayBlocked && (
        <button
          onClick={() => void unlockAudio()}
          className="mb-2 w-full rounded-xl border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-xs font-semibold text-amber-200 shadow-lg"
        >
          🔊 오디오 켜기
        </button>
      )}
      <div className="flex items-center gap-2 bg-zinc-900/95 border border-zinc-700 rounded-full pl-5 pr-2 py-2 shadow-2xl shadow-black/40">
        {error && !isInVoice && <span className="text-xs text-red-400">{error}</span>}

        {!isInVoice ? (
          <button
            onClick={() => joinVoice(roomId)}
            className="px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
          >
            🎙️ 통화 참여
          </button>
        ) : (
          <>
            <span className="text-sm font-semibold text-white whitespace-nowrap">
              🎙️ {voiceMembers.length}명{' '}
              {meTalking && <span className="text-emerald-400 animate-pulse">●</span>}
              {inputMode === 'push_to_talk' && isPttActive && (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/70 text-emerald-300 border border-emerald-700">PTT 열림</span>
              )}
            </span>

            <button
              onClick={toggleMute}
              title={isMuted ? '마이크 켜기' : '마이크 음소거'}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-base transition-colors ${
                isMuted ? 'bg-red-900/70 text-red-300' : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>

            <button
              onClick={toggleDeafen}
              title={isDeafened ? '헤드셋 켜기' : '헤드셋 끄기 (Deafen)'}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-base transition-colors ${
                isDeafened ? 'bg-red-900/70 text-red-300' : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              {isDeafened ? '🔕' : '🔊'}
            </button>

            {/* 마이크 설정 팝오버 — Phase 9 확장: VU + 테스트 + PTT */}
            <div ref={inputRef} className="relative">
              <button
                onClick={() => setShowInput((v) => !v)}
                title="마이크 설정"
                aria-label="마이크 설정"
                aria-expanded={showInput}
                className={`px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                  showInput ? 'bg-zinc-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                🎛️ {inputPercent}%
              </button>
              {showInput && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl space-y-3">
                  {/* 입력 게인 */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-300">마이크 입력</span>
                      <span className="text-xs font-mono text-emerald-400">{inputPercent}%</span>
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

                  <VuMeter />

                  {/* 3초 마이크 테스트 */}
                  <button
                    onClick={() => {
                      if (isTestingMic) void stopMicTest()
                      else void startMicTest()
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isTestingMic ? 'bg-amber-900/60 text-amber-200 border border-amber-700' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {isTestingMic ? '⏹️ 테스트 중지 (3초 녹음·재생)' : '🎤 3초 마이크 테스트'}
                  </button>

                  {/* 입력 모드 */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
                    <div className="mb-1 text-xs font-semibold text-zinc-300">입력 모드</div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setInputMode('voice_activity')}
                        aria-pressed={inputMode === 'voice_activity'}
                        className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                          inputMode === 'voice_activity' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        음성 감지
                      </button>
                      <button
                        onClick={() => setInputMode('push_to_talk')}
                        aria-pressed={inputMode === 'push_to_talk'}
                        className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                          inputMode === 'push_to_talk' ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        PTT
                      </button>
                    </div>
                    {inputMode === 'push_to_talk' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-zinc-400">단축키:</span>
                        <span className="rounded bg-zinc-800 px-2 py-1 text-xs font-mono text-sky-300 border border-zinc-700">
                          {formatPttKey(pttKey)}
                        </span>
                        <button
                          onClick={() => setIsCapturing((v) => !v)}
                          className={`ml-auto rounded px-2 py-1 text-xs font-semibold border transition-colors ${
                            isCapturing ? 'bg-amber-900/60 text-amber-200 border-amber-700' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                          }`}
                        >
                          {isCapturing ? '키 입력 대기...' : '변경'}
                        </button>
                      </div>
                    )}
                    {inputMode === 'push_to_talk' && (
                      <p className="mt-1 text-[10px] leading-tight text-zinc-500">PTT 모드에서는 {formatPttKey(pttKey)}를 누르고 있을 때만 마이크가 열립니다. Alt-Tab 시 자동 차단됩니다.</p>
                    )}
                  </div>

                  {/* Phase 12 — AI 딥러닝 잡음 제거 */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-300">AI 잡음 제거</span>
                      {!isDenoiserSupported && (
                        <span
                          title="이 브라우저는 AudioWorklet/WASM을 지원하지 않습니다"
                          className="text-[10px] text-zinc-500"
                        >
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
                      <span id="talklite-noise-label" className="text-xs text-zinc-400">AI 딥러닝 잡음 제거 사용</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isNoiseSuppressionEnabled}
                        aria-labelledby="talklite-noise-label"
                        disabled={!isDenoiserSupported || isNoiseLoading}
                        onClick={() => void setNoiseSuppression(!isNoiseSuppressionEnabled)}
                        className={`relative h-5 w-10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                          isNoiseSuppressionEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
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
                              noiseSuppressionModel === m ? 'bg-emerald-950/60 border border-emerald-800' : 'hover:bg-zinc-800/60 border border-transparent'
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
                </div>
              )}
            </div>

            {/* 마스터 볼륨 팝오버 */}
            <div ref={masterRef} className="relative">
              <button
                onClick={() => setShowMaster((v) => !v)}
                title="마스터 스피커 볼륨"
                aria-label="마스터 스피커 볼륨 설정"
                aria-expanded={showMaster}
                className={`px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                  showMaster ? 'bg-zinc-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                🔊 {masterPercent}%
              </button>
              {showMaster && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-48 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">스피커 출력</span>
                    <span className="text-xs font-mono text-sky-400">{masterPercent}%</span>
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
                    aria-label="마스터 스피커 볼륨"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={masterPercent}
                    aria-valuetext={`${masterPercent}%`}
                    className="w-full accent-sky-500"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                </div>
              )}
            </div>

            {inputDevices.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <span className="sr-only">마이크 입력 장치</span>
                <span aria-hidden="true">🎙️</span>
                <select
                  value={selectedAudioDeviceId ?? inputDevices[0]?.deviceId ?? ''}
                  aria-label="마이크 입력 장치 선택"
                  onChange={(e) => {
                    if (e.target.value) void setDevice(e.target.value)
                  }}
                  className="bg-zinc-800 text-xs text-zinc-300 rounded-full px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  {inputDevices.map((d, index) => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-zinc-900">
                      {cleanDeviceLabel(d.label, `마이크 ${index + 1}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {canSelectOutput && outputDevices.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <span className="sr-only">스피커 출력 장치</span>
                <span aria-hidden="true">🔊</span>
                <select
                  value={selectedSpeakerDeviceId ?? outputDevices[0]?.deviceId ?? ''}
                  aria-label="스피커 출력 장치 선택"
                  aria-busy={isOutputChanging}
                  disabled={isOutputChanging}
                  onChange={(e) => void setOutputDevice(e.target.value)}
                  className="bg-zinc-800 text-xs text-zinc-300 rounded-full px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-wait disabled:opacity-60"
                >
                  {outputDevices.map((d, index) => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-zinc-900">
                      {cleanDeviceLabel(d.label, `스피커 ${index + 1}`)}
                    </option>
                  ))}
                </select>
                <span className="sr-only" role="status" aria-live="polite">
                  {isOutputChanging ? '스피커 전환 중' : outputError ?? (outputRouteState === 'applied' ? '스피커 전환 완료' : '')}
                </span>
              </label>
            )}
            {error && isInVoice && <span role="status" aria-live="polite" className="sr-only">{error}</span>}

            <button
              onClick={leaveVoice}
              className="px-4 py-2 rounded-full bg-red-950/70 hover:bg-red-900/80 text-red-300 text-sm font-semibold transition-colors"
            >
              통화 종료
            </button>
          </>
        )}
      </div>
    </div>
  )
}
