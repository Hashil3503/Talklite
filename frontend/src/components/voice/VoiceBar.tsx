import React, { useState } from 'react'
import { useVoiceStore, getUid, cleanDeviceLabel } from '../../store/voiceStore'
import { VuMeter } from './VuMeter'
import { AudioSettingsModal } from './AudioSettingsModal'

export const VoiceBar: React.FC<{ roomId: string }> = ({ roomId }) => {
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const isMuted = useVoiceStore((state) => state.isMuted)
  const isDeafened = useVoiceStore((state) => state.isDeafened)
  const voiceMembers = useVoiceStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const inputDevices = useVoiceStore((state) => state.inputDevices)
  const outputDevices = useVoiceStore((state) => state.outputDevices)
  const selectedAudioDeviceId = useVoiceStore((state) => state.selectedAudioDeviceId)
  const selectedSpeakerDeviceId = useVoiceStore((state) => state.selectedSpeakerDeviceId)
  const canSelectOutput = useVoiceStore((state) => state.canSelectOutput)
  const isOutputChanging = useVoiceStore((state) => state.isOutputChanging)
  const outputRouteState = useVoiceStore((state) => state.outputRouteState)
  const outputError = useVoiceStore((state) => state.outputError)
  const error = useVoiceStore((state) => state.error)
  const isAudioAutoplayBlocked = useVoiceStore((state) => state.isAudioAutoplayBlocked)

  const joinVoice = useVoiceStore((state) => state.joinVoice)
  const leaveVoice = useVoiceStore((state) => state.leaveVoice)
  const toggleMute = useVoiceStore((state) => state.toggleMute)
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen)
  const setDevice = useVoiceStore((state) => state.setDevice)
  const setOutputDevice = useVoiceStore((state) => state.setOutputDevice)
  const unlockAudio = useVoiceStore((state) => state.unlockAudio)

  const [showSettings, setShowSettings] = useState(false)

  const me = getUid()
  const meTalking = !!speaking[me]

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center w-[min(92vw,880px)]">
        {isAudioAutoplayBlocked && (
          <button
            onClick={() => void unlockAudio()}
            className="mb-2 w-full rounded-xl border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-xs font-semibold text-amber-200 shadow-lg"
          >
            🔊 오디오 켜기
          </button>
        )}
        <div className="flex items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[#121217]/95 px-4 py-2.5 shadow-2xl shadow-black/50 backdrop-blur-md flex-wrap justify-center">
          {error && !isInVoice && <span className="text-xs text-[#FF371A]">{error}</span>}

          {!isInVoice ? (
            <button
              onClick={() => joinVoice(roomId)}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-[#10B981] to-[#50C2F3] text-black text-sm font-bold transition-transform hover:scale-105"
            >
              🎙️ 통화 참여
            </button>
          ) : (
            <>
              <span className="text-sm font-semibold text-white whitespace-nowrap">
                🎙️ {voiceMembers.length}명 {meTalking && <span className="text-[#10B981] animate-pulse">●</span>}
              </span>

              <button
                onClick={toggleMute}
                title={isMuted ? '마이크 켜기' : '마이크 음소거'}
                aria-label={isMuted ? '마이크 켜기' : '마이크 음소거'}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition-colors ${
                  isMuted ? 'bg-[#FF371A]/25 text-[#FF371A]' : 'bg-[#0B0B0E] hover:bg-[#171720]'
                }`}
              >
                {isMuted ? '🔇' : '🎤'}
              </button>

              <button
                onClick={toggleDeafen}
                title={isDeafened ? '헤드셋 켜기' : '헤드셋 끄기 (Deafen)'}
                aria-label={isDeafened ? '헤드셋 켜기' : '헤드셋 끄기 (Deafen)'}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition-colors ${
                  isDeafened ? 'bg-[#FF371A]/25 text-[#FF371A]' : 'bg-[#0B0B0E] hover:bg-[#171720]'
                }`}
              >
                {isDeafened ? '🔕' : '🔊'}
              </button>

              {/* VU 미터 (20단계 6그라디언트) */}
              <div className="w-36 sm:w-44">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-400">VU</span>
                  <span className="text-[10px] text-zinc-600">20단계</span>
                </div>
                <VuMeter size="sm" />
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
                    className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0B0B0E] px-3 py-2 text-xs text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    {inputDevices.map((d, index) => (
                      <option key={d.deviceId} value={d.deviceId} className="bg-[#121217]">
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
                    className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0B0B0E] px-3 py-2 text-xs text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-wait disabled:opacity-60"
                  >
                    {outputDevices.map((d, index) => (
                      <option key={d.deviceId} value={d.deviceId} className="bg-[#121217]">
                        {cleanDeviceLabel(d.label, `스피커 ${index + 1}`)}
                      </option>
                    ))}
                  </select>
                  <span className="sr-only" role="status" aria-live="polite">
                    {isOutputChanging ? '스피커 전환 중' : outputError ?? (outputRouteState === 'applied' ? '스피커 전환 완료' : '')}
                  </span>
                </label>
              )}
              {error && isInVoice && (
                <span role="status" aria-live="polite" className="sr-only">
                  {error}
                </span>
              )}

              <button
                onClick={() => setShowSettings(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B0B0E] text-base hover:bg-[#171720]"
                title="오디오 설정"
                aria-label="오디오 설정"
              >
                ⚙️
              </button>

              <button
                onClick={leaveVoice}
                className="rounded-full bg-[#FF371A]/20 px-4 py-2 text-sm font-semibold text-[#FF371A] transition-colors hover:bg-[#FF371A]/30"
              >
                통화 종료
              </button>
            </>
          )}
        </div>
      </div>

      <AudioSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}