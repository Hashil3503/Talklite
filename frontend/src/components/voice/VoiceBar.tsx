import React from 'react'
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
  const joinVoice = useVoiceStore((state) => state.joinVoice)
  const leaveVoice = useVoiceStore((state) => state.leaveVoice)
  const toggleMute = useVoiceStore((state) => state.toggleMute)
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen)
  const setDevice = useVoiceStore((state) => state.setDevice)
  const unlockAudio = useVoiceStore((state) => state.unlockAudio)

  const me = getUid()
  const meTalking = !!speaking[me]

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
      {isAudioAutoplayBlocked && (
        <button
          onClick={() => void unlockAudio()}
          className="mb-2 w-full rounded-xl border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-xs font-semibold text-amber-200 shadow-lg"
        >
          오디오를 활성화하려면 클릭하세요
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
