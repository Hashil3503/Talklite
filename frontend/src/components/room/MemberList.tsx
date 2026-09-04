import React, { useEffect, useRef, useState } from 'react'
import { useRoomStore } from '../../store/roomStore'
import { useVoiceStore } from '../../store/voiceStore'
import { getUid } from '../../store/voiceStore'
import { kickUser } from '../../lib/api'

export const MemberList: React.FC = () => {
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const voiceMembers = useRoomStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const peerVolumes = useVoiceStore((state) => state.peerVolumes)
  const peerMutes = useVoiceStore((state) => state.peerMutes)
  const setPeerVolume = useVoiceStore((state) => state.setPeerVolume)
  const togglePeerMute = useVoiceStore((state) => state.togglePeerMute)
  const currentUserId = getUid()

  const [openPeer, setOpenPeer] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openPeer === null) return
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-peer-card]')) setOpenPeer(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenPeer(null)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [openPeer])

  if (!currentRoom) return null

  const isHost = currentRoom.host === currentUserId

  const handleKick = async (targetUser: string, type: 'TEMPORARY' | 'PERMANENT') => {
    if (!confirm(`${targetUser}님을 ${type === 'TEMPORARY' ? '임시 강퇴(10분)' : '영구 강퇴'}하시겠습니까?`)) {
      return
    }
    try {
      await kickUser(currentRoom.id, currentUserId, targetUser, type)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '강퇴 처리에 실패했습니다.'
      alert(msg)
    }
  }

  return (
    <div ref={containerRef} className="w-64 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#121217]/70 p-4 flex flex-col">
      <div className="flex items-center justify-between pb-3 border-b border-[rgba(255,255,255,0.08)] mb-3">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">참여자 목록</h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#50C2F3]/10 text-[#50C2F3] border border-[rgba(80,194,243,0.3)]">
          {currentRoom.count} / {currentRoom.capacity}명
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {currentRoom.members.map((member) => {
          const isMemberHost = member === currentRoom.host
          const isMe = member === currentUserId
          const inVoice = voiceMembers.includes(member)
          const isTalking = !!speaking[member]
          const isPeerMuted = !!peerMutes[member]
          const vol = peerVolumes[member] ?? 1
          const volPercent = Math.round((isPeerMuted ? 0 : vol) * 100)
          const isOpen = openPeer === member

          return (
            <div
              key={member}
              data-peer-card={member}
              className="flex flex-col rounded-lg bg-[#171720]/60 hover:bg-[#171720] transition-colors group"
            >
              <div className="flex items-center justify-between px-2.5 py-2">
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

                <div className="flex items-center gap-1 shrink-0">
                  {inVoice && !isMe && (
                    <>
                      <button
                        onClick={() => setOpenPeer(isOpen ? null : member)}
                        title="개별 볼륨 조절"
                        aria-label={`${member} 개별 볼륨 조절`}
                        aria-expanded={isOpen}
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                          isOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {isPeerMuted ? '🔇' : '🔊'}
                      </button>
                      <button
                        onClick={() => togglePeerMute(member)}
                        title={isPeerMuted ? '음소거 해제' : '개별 음소거'}
                        aria-label={`${member} 개별 음소거`}
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                          isPeerMuted ? 'bg-red-900/60 text-red-300' : 'bg-zinc-800 hover:bg-zinc-700'
                        }`}
                      >
                        {isPeerMuted ? '🚫' : '🔈'}
                      </button>
                    </>
                  )}
                  {isHost && !isMe && (
                    <div className="hidden group-hover:flex items-center space-x-1">
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
              </div>

              {inVoice && !isMe && isOpen && (
                <div className="mx-2 mb-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0B0B0E] p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">{member} 볼륨</span>
                    <span className="text-xs font-mono text-sky-400">{volPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={isPeerMuted ? 0 : Math.round(vol * 100)}
                    onChange={(e) => {
                      const nextPercent = Number(e.target.value)
                      if (!Number.isFinite(nextPercent)) return
                      // 슬라이더로 음소거 해제 효과: muted 상태에서 올리면 자동 해제 로직
                      if (isPeerMuted && nextPercent > 0) {
                        togglePeerMute(member)
                      }
                      setPeerVolume(member, nextPercent / 100)
                    }}
                    aria-label={`${member} 개별 볼륨`}
                    aria-valuemin={0}
                    aria-valuemax={200}
                    aria-valuenow={isPeerMuted ? 0 : Math.round(vol * 100)}
                    aria-valuetext={`${isPeerMuted ? 0 : Math.round(vol * 100)}%`}
                    className="w-full accent-sky-500"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                    <span>0%</span>
                    <span>100%</span>
                    <span>200%</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
