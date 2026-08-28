import React, { useEffect, useRef, useState } from 'react'
import { useVoiceStore } from '../../store/voiceStore'
import { getUid } from '../../store/voiceStore'

export const VoiceBar: React.FC<{ roomId: string }> = ({ roomId }) => {
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const isMuted = useVoiceStore((state) => state.isMuted)
  const isDeafened = useVoiceStore((state) => state.isDeafened)
  const voiceMembers = useVoiceStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const audioDevices = useVoiceStore((state) => state.audioDevices)
  const error = useVoiceStore((state) => state.error)
  const isAudioAutoplayBlocked = useVoiceStore((state) => state.isAudioAutoplayBlocked)
  const inputGain = useVoiceStore((state) => state.inputGain)
  const masterVolume = useVoiceStore((state) => state.masterVolume)
  const joinVoice = useVoiceStore((state) => state.joinVoice)
  const leaveVoice = useVoiceStore((state) => state.leaveVoice)
  const toggleMute = useVoiceStore((state) => state.toggleMute)
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen)
  const setDevice = useVoiceStore((state) => state.setDevice)
  const unlockAudio = useVoiceStore((state) => state.unlockAudio)
  const setInputGain = useVoiceStore((state) => state.setInputGain)
  const setMasterVolume = useVoiceStore((state) => state.setMasterVolume)

  const [showInput, setShowInput] = useState(false)
  const [showMaster, setShowMaster] = useState(false)
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

            {/* 마이크 입력 게인 팝오버 */}
            <div ref={inputRef} className="relative">
              <button
                onClick={() => setShowInput((v) => !v)}
                title="마이크 입력 게인"
                aria-label="마이크 입력 게인 설정"
                aria-expanded={showInput}
                className={`px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                  showInput ? 'bg-zinc-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                🎛️ {inputPercent}%
              </button>
              {showInput && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-48 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
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

            {audioDevices.length > 1 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) void setDevice(e.target.value)
                  e.target.value = ''
                }}
                className="bg-zinc-800 text-xs text-zinc-300 rounded-full px-3 py-2 focus:outline-none"
              >
                <option value="" disabled>
                  마이크
                </option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-zinc-900">
                    {d.label || '마이크'}
                  </option>
                ))}
              </select>
            )}

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
