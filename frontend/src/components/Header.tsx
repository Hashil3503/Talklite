import React from 'react'
import { useToastStore } from '../store/toastStore'
import type { ActiveView } from '../App'

interface HeaderProps {
  activeView: ActiveView
  isInRoom: boolean
  roomTitle?: string | null
  onSwitchView: (view: ActiveView) => void
  onExit: () => void
}

export const Header: React.FC<HeaderProps> = ({ activeView, isInRoom, roomTitle, onSwitchView, onExit }) => {
  const showToast = useToastStore((state) => state.showToast)
  const uid = localStorage.getItem('talklite_uid') || 'anonymous'
  const shortUid = `${uid.slice(0, 4)}${uid.length > 4 ? '…' : ''}`

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(uid)
      showToast(`내 익명 ID가 복사되었습니다: ${uid}`, 'success')
    } catch {
      showToast('클립보드 복사에 실패했습니다.', 'error')
    }
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] bg-[#121217]/85 px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#FF371A] to-[#8B5CF6] text-sm shadow-lg shadow-[#FF371A]/20">
            🎙️
          </span>
          <span className="text-base font-extrabold tracking-tight text-white">Talklite</span>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0B0B0E]/60 p-1">
          <button
            onClick={() => onSwitchView('LOBBY')}
            aria-pressed={activeView === 'LOBBY'}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeView === 'LOBBY'
                ? 'bg-[#171720] text-[#50C2F3] shadow-sm ring-1 ring-[rgba(255,255,255,0.12)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🎮 파티 로비
          </button>
          <button
            onClick={() => onSwitchView('ROOM')}
            aria-pressed={activeView === 'ROOM'}
            disabled={!isInRoom}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeView === 'ROOM'
                ? 'bg-[#171720] text-[#10B981] shadow-sm ring-1 ring-[rgba(255,255,255,0.12)]'
                : isInRoom
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'cursor-not-allowed text-zinc-600'
            }`}
          >
            🎙️ 보이스 룸{isInRoom && roomTitle ? ` · ${roomTitle}` : ''}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => void copyUid()}
          title="클릭하여 내 익명 ID 복사"
          className="hidden sm:flex items-center gap-1.5 rounded-full border border-[rgba(255,255,255,0.08)] bg-[#171720] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-[rgba(255,255,255,0.18)] hover:text-white"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#50C2F3] to-[#8B5CF6] text-[9px] font-bold text-black">
            U
          </span>
          <span className="font-mono">#{shortUid}</span>
        </button>

        {isInRoom && (
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-[rgba(255,55,26,0.4)] bg-[#FF371A]/15 px-3 py-1.5 text-xs font-semibold text-[#FF371A] transition-colors hover:bg-[#FF371A]/25"
          >
            🚪 방 나가기
          </button>
        )}
      </div>
    </header>
  )
}