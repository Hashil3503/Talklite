import React from 'react'
import { useVoiceStore } from '../../store/voiceStore'
import { VuMeter } from './VuMeter'

interface FloatingVoiceWidgetProps {
  onReturnToRoom: () => void
}

/**
 * P0-06: 로비 둘러보기 중 통화 지속 표시 카드 (bottom-28 right-6, 토스트 3스택 겹침 방지).
 * VU는 공용 VuMeter(subscribe + ref DOM) 재사용 — 신규 rAF/Analyser 금지.
 */
export const FloatingVoiceWidget: React.FC<FloatingVoiceWidgetProps> = ({ onReturnToRoom }) => {
  const isMuted = useVoiceStore((state) => state.isMuted)
  const voiceMembers = useVoiceStore((state) => state.voiceMembers)
  const toggleMute = useVoiceStore((state) => state.toggleMute)

  return (
    <div className="fixed bottom-28 right-6 z-40 w-64 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#171720]/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold text-[#10B981]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          통화 중 · {voiceMembers.length}명
        </span>
        <button
          onClick={toggleMute}
          title={isMuted ? '마이크 켜기' : '마이크 음소거'}
          aria-label={isMuted ? '마이크 켜기' : '마이크 음소거'}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
            isMuted ? 'bg-[#FF371A]/25 text-[#FF371A]' : 'bg-[#0B0B0E] text-zinc-300 hover:bg-[#121217]'
          }`}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400">VU 레벨</span>
          <span className="text-[10px] text-zinc-500">{isMuted ? '음소거' : '라이브'}</span>
        </div>
        <VuMeter size="sm" />
      </div>

      <button
        onClick={onReturnToRoom}
        className="w-full rounded-xl bg-gradient-to-r from-[#10B981] to-[#50C2F3] px-3 py-2 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.02]"
      >
        🎙️ 보이스 룸 복귀
      </button>
    </div>
  )
}