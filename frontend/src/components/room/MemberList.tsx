import React from 'react'
import { useRoomStore } from '../../store/roomStore'
import { useVoiceStore } from '../../store/voiceStore'
import { kickUser } from '../../lib/api'

export const MemberList: React.FC = () => {
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const voiceMembers = useRoomStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const currentUserId = localStorage.getItem('talklite_uid') || ''

  if (!currentRoom) return null

  const isHost = currentRoom.host === currentUserId

  const handleKick = async (targetUser: string, type: 'TEMPORARY' | 'PERMANENT') => {
    if (!confirm(`${targetUser}님을 ${type === 'TEMPORARY' ? '임시 강퇴(10분)' : '영구 강퇴'}하시겠습니까?`)) {
      return
    }
    try {
      await kickUser(currentRoom.id, currentUserId, targetUser, type)
    } catch (err: any) {
      alert(err.message || '강퇴 처리에 실패했습니다.')
    }
  }

  return (
    <div className="w-64 bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">참여자 목록</h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-400 border border-blue-800/40">
          {currentRoom.count} / {currentRoom.capacity}명
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {currentRoom.members.map((member) => {
          const isMemberHost = member === currentRoom.host
          const isMe = member === currentUserId
          const inVoice = voiceMembers.includes(member)
          const isTalking = !!speaking[member]

          return (
            <div
              key={member}
              className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/80 transition-colors group"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    inVoice ? (isTalking ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-600') : 'bg-zinc-600'
                  } ${inVoice ? 'ring-2 ring-emerald-400/50' : ''}`}
                />
                <span className={`text-sm truncate ${isMe ? 'font-bold text-white' : 'text-zinc-300'}`}>
                  {member}
                </span>
                {inVoice && <span title="통화 중" className="text-xs shrink-0">🎙️</span>}
                {isTalking && <span title="발화 중" className="text-emerald-400 text-xs shrink-0">●</span>}
                {isMemberHost && <span title="방장" className="text-amber-400 text-xs shrink-0">👑</span>}
                {isMe && <span className="text-[10px] text-zinc-500 shrink-0">(나)</span>}
              </div>

              {isHost && !isMe && (
                <div className="hidden group-hover:flex items-center space-x-1 shrink-0">
                  <button
                    onClick={() => handleKick(member, 'TEMPORARY')}
                    title="10분 임시 강퇴"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-amber-900/60 hover:text-amber-300 text-zinc-300 transition-colors"
                  >
                    임시
                  </button>
                  <button
                    onClick={() => handleKick(member, 'PERMANENT')}
                    title="영구 강퇴"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-red-900/60 hover:text-red-300 text-zinc-300 transition-colors"
                  >
                    영구
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
