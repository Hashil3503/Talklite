import React, { useEffect, useState } from 'react'
import { useRoomStore } from '../../store/roomStore'
import { useVoiceStore } from '../../store/voiceStore'
import { getUid } from '../../store/voiceStore'
import { kickUser } from '../../lib/api'

export const MemberList: React.FC<{ roomId: string }> = ({ roomId }) => {
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const voiceMembers = useRoomStore((state) => state.voiceMembers)
  const speaking = useVoiceStore((state) => state.speakingUsers)
  const peerVolumes = useVoiceStore((state) => state.peerVolumes)
  const peerMutes = useVoiceStore((state) => state.peerMutes)
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const voiceCount = useVoiceStore((state) => state.voiceMembers.length)
  const setPeerVolume = useVoiceStore((state) => state.setPeerVolume)
  const togglePeerMute = useVoiceStore((state) => state.togglePeerMute)
  const joinVoice = useVoiceStore((state) => state.joinVoice)
  const leaveVoice = useVoiceStore((state) => state.leaveVoice)
  const currentUserId = getUid()

  const [openPeer, setOpenPeer] = useState<string | null>(null)

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
  const emptySlots = Math.max(0, currentRoom.capacity - currentRoom.count)

  const handleKick = async (targetUser: string, type: 'TEMPORARY' | 'PERMANENT') => {
    if (!confirm(`${targetUser}님을 ${type === 'TEMPORARY' ? '임시 강퇴(10분)' : '영구 강퇴'}하시겠습니까?`)) {
      return
    }
    try {
      await kickUser(currentRoom.id, currentUserId, targetUser, type)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '강퇴 처리에 실패했습니다.'
      window.alert(msg)
    }
  }

  return (
    <aside className="room-sidebar-member">
      <div className="sidebar-header">
        <span className="sidebar-title">
          참여자 목록 (<strong>{currentRoom.count}</strong>/{currentRoom.capacity})
        </span>
        <span className="badge-live-sm">
          <span className="pulse-dot" /> P2P MESH
        </span>
      </div>

      <div className="member-list-scroll">
        {currentRoom.members.map((member) => {
          const isMemberHost = member === currentRoom.host
          const isMe = member === currentUserId
          const inVoice = voiceMembers.includes(member)
          const isTalking = !!speaking[member]
          const isPeerMuted = !!peerMutes[member]
          const vol = peerVolumes[member] ?? 1
          const volPercent = Math.round((isPeerMuted ? 0 : vol) * 100)
          const isOpen = openPeer === member
          const avatarChar = member.charAt(0).toUpperCase() || '?'
          const subStatus = inVoice ? (isTalking ? '발화 중' : '음성 연결됨') : '음성 미연결'

          return (
            <div
              key={member}
              data-peer-card={member}
              className={`member-item ${isTalking && inVoice ? 'speaking' : ''}`}
            >
              <div className="member-avatar-wrap">
                <div className={`avatar-box ${isMemberHost ? 'avatar-host' : ''}`}>{avatarChar}</div>
                {isTalking && inVoice && <span className="speaking-ring" aria-hidden="true" />}
              </div>

              <div className="member-meta">
                <div className="member-name-row">
                  <span className="member-name">
                    {member}
                    {isMe ? ' (나)' : ''}
                  </span>
                  {isMemberHost && <span className="crown-icon">👑</span>}
                </div>
                <span className="member-sub-status">{subStatus}</span>
              </div>

              <div className="member-vol-control">
                {inVoice && !isMe ? (
                  <>
                    {isPeerMuted ? (
                      <button
                        className="vol-indicator"
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                        title="개별 음소거 해제"
                        onClick={() => togglePeerMute(member)}
                      >
                        🔇
                      </button>
                    ) : (
                      <button
                        className="vol-indicator"
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                        title="개별 볼륨 조절 (0~200%)"
                        aria-expanded={isOpen}
                        onClick={() => setOpenPeer(isOpen ? null : member)}
                      >
                        {volPercent}%
                      </button>
                    )}
                    {isOpen && (
                      <input
                        type="range"
                        min={0}
                        max={200}
                        step={5}
                        className="vol-slider"
                        value={isPeerMuted ? 0 : Math.round(vol * 100)}
                        aria-label={`${member} 개별 볼륨`}
                        onChange={(e) => {
                          const nextPercent = Number(e.target.value)
                          if (!Number.isFinite(nextPercent)) return
                          if (isPeerMuted && nextPercent > 0) {
                            togglePeerMute(member)
                          }
                          setPeerVolume(member, nextPercent / 100)
                        }}
                      />
                    )}
                  </>
                ) : inVoice ? (
                  <span className="vol-indicator">{volPercent}%</span>
                ) : null}
              </div>

              {isHost && !isMe && (
                <div className="kick-actions" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <button
                    className="kick-btn"
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(245, 158, 11, 0.15)', color: 'var(--brand-yellow)', border: '1px solid rgba(245, 158, 11, 0.25)', cursor: 'pointer' }}
                    title="10분 임시 강퇴"
                    onClick={() => void handleKick(member, 'TEMPORARY')}
                  >
                    임시
                  </button>
                  <button
                    className="kick-btn"
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', cursor: 'pointer' }}
                    title="영구 강퇴"
                    onClick={() => void handleKick(member, 'PERMANENT')}
                  >
                    영구
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {emptySlots > 0 && <div className="empty-slot-card">+ 빈 자리 ({emptySlots}명 초대 가능)</div>}

      {/* ★ 통화 연결 버튼 — 사이드바 좌측 하단 상시 노출 */}
      <div className="member-voice-control">
        {!isInVoice ? (
          <button className="btn-voice-join" onClick={() => void joinVoice(roomId)}>
            🎙️ 통화 참여
          </button>
        ) : (
          <>
            <span className="voice-status-line">
              <span className="pulse-dot" /> 🎙️ 통화 중 ({voiceCount}명)
            </span>
            <button className="btn-voice-end" onClick={leaveVoice}>
              통화 종료
            </button>
          </>
        )}
      </div>
    </aside>
  )
}