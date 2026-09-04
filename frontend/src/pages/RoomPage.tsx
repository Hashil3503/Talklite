import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRoomStore } from '../store/roomStore'
import { useVoiceStore } from '../store/voiceStore'
import { useToastStore } from '../store/toastStore'
import { ChatLog } from '../components/room/ChatLog'
import { MemberList } from '../components/room/MemberList'
import { InviteModal } from '../components/room/InviteModal'
import { EditRoomModal } from '../components/room/EditRoomModal'
import { VoiceBar } from '../components/voice/VoiceBar'
import { joinRoom, getRoom, deleteRoom, uploadRoomImage, getRoomInviteCode } from '../lib/api'
import { gameBadgeClass } from '../lib/gameBadge'
import { getOrCreateAnonymousId } from '../lib/uid'

interface RoomPageProps {
  roomId: string
  onExit: () => void
  onKicked: () => void
}

async function compressToWebP(file: File): Promise<Blob> {
  const maxW = 1920
  // try createImageBitmap fast path
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file)
      let w = bitmap.width
      let h = bitmap.height
      if (w > maxW) {
        h = Math.round((h * maxW) / w)
        w = maxW
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no ctx')
      ctx.drawImage(bitmap, 0, 0, w, h)
      bitmap.close?.()
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.8)
      )
      if (blob) return blob
    }
  } catch {}
  // fallback: Image element
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      let w = img.width
      let h = img.height
      if (w > maxW) {
        h = Math.round((h * maxW) / w)
        w = maxW
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('no ctx'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (b) => {
          if (b) resolve(b)
          else reject(new Error('toBlob failed'))
        },
        'image/webp',
        0.8
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    img.src = url
  })
}

export const RoomPage: React.FC<RoomPageProps> = ({ roomId, onExit, onKicked }) => {
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const setCurrentRoom = useRoomStore((state) => state.setCurrentRoom)
  const sendChat = useRoomStore((state) => state.sendChat)
  const sendImageChat = useRoomStore((state) => state.sendImageChat)
  const showToast = useToastStore((state) => state.showToast)

  const [input, setInput] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const isComposingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hadRoomRef = useRef(false)
  const currentUserId = getOrCreateAnonymousId()

  // @멘션 자동완성 상태
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionCandidates = React.useMemo(() => {
    if (mentionQuery === null || !currentRoom) return []
    const q = mentionQuery.toLowerCase()
    const specials = ['everyone', 'all']
    const base = [...currentRoom.members]
    let filtered = base.filter((m) => m.toLowerCase().includes(q))
    for (const s of specials) {
      if (s.includes(q) && !filtered.includes(s)) filtered.push(s)
    }
    if (q === '') {
      const extras = specials.filter((s) => !filtered.includes(s))
      filtered = [...filtered, ...extras]
    }
    return filtered.slice(0, 8)
  }, [mentionQuery, currentRoom])

  const updateMentionState = useCallback(
    (value: string, caret: number) => {
      const before = value.slice(0, caret)
      const m = before.match(/\B@([A-Za-z0-9._가-힣]{0,30})$/)
      if (m) {
        setMentionQuery(m[1] ?? '')
        setMentionIndex(0)
      } else {
        setMentionQuery(null)
      }
    },
    []
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setInput(v)
    const caret = e.target.selectionStart ?? v.length
    updateMentionState(v, caret)
  }

  const applyMention = useCallback(
    (candidate: string) => {
      const el = inputRef.current
      if (!el) return
      const value = el.value
      const caret = el.selectionStart ?? value.length
      const before = value.slice(0, caret)
      const after = value.slice(caret)
      const m = before.match(/\B@([A-Za-z0-9._가-힣]{0,30})$/)
      if (!m) return
      const start = m.index ?? 0
      const nextBefore = before.slice(0, start) + `@${candidate} `
      const next = nextBefore + after
      setInput(next)
      setMentionQuery(null)
      requestAnimationFrame(() => {
        const pos = nextBefore.length
        el.focus()
        el.setSelectionRange(pos, pos)
      })
    },
    []
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const nativeEvent = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229 || isComposingRef.current) return
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((prev) => (prev + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const sel = mentionCandidates[mentionIndex]
        if (sel) applyMention(sel)
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
  }

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false
    const el = e.currentTarget
    requestAnimationFrame(() => {
      if (inputRef.current !== el) return
      const value = el.value
      setInput(value)
      updateMentionState(value, el.selectionStart ?? value.length)
    })
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageItems: DataTransferItem[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type.startsWith('image/')) imageItems.push(it)
    }
    if (imageItems.length === 0) return
    e.preventDefault()
    if (uploading) return
    const file = imageItems[0].getAsFile()
    if (!file) return
    setUploading(true)
    try {
      const compressed = await compressToWebP(file)
      const result = await uploadRoomImage(roomId, compressed, `paste-${Date.now()}.webp`)
      const mediaUrl = (result as { mediaUrl?: string; url?: string }).mediaUrl ?? (result as { url: string }).url
      if (mediaUrl) {
        await sendImageChat(mediaUrl)
      }
    } catch (err) {
      console.error('Clipboard image upload failed:', err)
      showToast('이미지 업로드에 실패했습니다.', 'error')
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (!currentRoom || currentRoom.id !== roomId) {
      setLoading(true)
      joinRoom(roomId, currentUserId)
        .then((room) => setCurrentRoom(room))
        .catch(() => getRoom(roomId).then((room) => setCurrentRoom(room)))
        .catch((err) => {
          showToast(err.message || '방 정보를 불러오지 못했습니다.', 'error')
          onKicked()
        })
        .finally(() => setLoading(false))
    }
  }, [roomId, currentRoom, setCurrentRoom, onKicked, currentUserId, showToast])

  // P0-01: 뷰 전환 시 음성 세션 지속 — 언마운트 시 disconnectRoomVoice 금지 (명시적 퇴장은 App teardown이 담당)
  useEffect(() => {
    void useVoiceStore.getState().connectRoomVoice(roomId)
  }, [roomId])

  // REMOTE_EJECT: currentRoom이 원격 소멸/강퇴로 null이 되면 로비로
  useEffect(() => {
    if (currentRoom) {
      hadRoomRef.current = true
    } else if (hadRoomRef.current) {
      hadRoomRef.current = false
      onKicked()
    }
  }, [currentRoom, onKicked])

  useEffect(() => {
    const handleKicked = () => {
      showToast('방장에 의해 강퇴되었습니다.', 'error')
      onKicked()
    }
    window.addEventListener('talklite:kicked', handleKicked)
    return () => window.removeEventListener('talklite:kicked', handleKicked)
  }, [onKicked, showToast])

  // 6자리 영숫자 순수 초대코드 로드 (getOrCreate — 멱등)
  useEffect(() => {
    if (!currentRoom || currentRoom.id !== roomId) return
    getRoomInviteCode(roomId)
      .then((res) => setInviteCode(res.code))
      .catch(() => setInviteCode(null))
  }, [currentRoom, roomId])

  const copyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      showToast(`초대코드가 복사되었습니다: ${inviteCode}`, 'success')
    } catch {
      showToast('클립보드 복사에 실패했습니다.', 'error')
    }
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (isComposingRef.current || !input.trim()) return
    sendChat(input)
    setInput('')
    setMentionQuery(null)
  }

  const handleExit = () => {
    const lastMember = currentRoom && currentRoom.count === 1 && currentRoom.type === 'TEMPORARY'
    const message = lastMember ? '마지막 인원이므로 방이 삭제됩니다.\n계속 나가시겠습니까?' : '방에서 나가시겠습니까?'
    if (confirm(message)) {
      onExit()
    }
  }

  const handleDeleteRoom = async () => {
    if (!currentRoom) return
    const ok = confirm(
      '정말 방을 완전히 삭제(폭파)하시겠습니까?\n방 안의 모든 인원이 퇴장되며 영구 방 정보가 완전히 삭제됩니다.'
    )
    if (!ok) return
    try {
      await deleteRoom(roomId, currentUserId)
      onKicked()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '방 삭제에 실패했습니다.'
      showToast(msg, 'error')
    }
  }

  if (loading || !currentRoom) {
    return (
      <div className="room-page-layout" style={{ height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>방에 접속 중입니다...</p>
      </div>
    )
  }

  const shortId = roomId.slice(0, 4)
  const isHost = currentRoom.host === currentUserId

  return (
    <div className="room-page-layout">
      {/* Room Top Bar */}
      <div className="room-page-header">
        <div className="room-header-left">
          <span className={`badge-game ${gameBadgeClass(currentRoom.game)}`}>{currentRoom.game}</span>
          <h2 className="room-page-title">👑 {currentRoom.title || currentRoom.game}</h2>
          {currentRoom.scope === 'PRIVATE' ? (
            <span className="badge-scope private">🔒 비공개</span>
          ) : currentRoom.type === 'PERMANENT' ? (
            <span className="badge-scope permanent">영구방 ⭐</span>
          ) : (
            <span className="badge-scope public">공개방</span>
          )}
          <span className="room-id-tag">ID: #{shortId}</span>
        </div>

        <div className="room-header-actions">
          <button
            className="btn-action"
            onClick={() => void copyInviteCode()}
            disabled={!inviteCode}
            title="6자리 초대코드 복사"
          >
            🔗 초대코드 ({inviteCode ?? '로딩 중'})
          </button>

          {isHost && (
            <>
              <button className="btn-action" onClick={() => setShowEdit(true)} title="방 설정 변경 (방장 전용)">
                ⚙️ 방 설정
              </button>
              <button className="btn-action" onClick={() => void handleDeleteRoom()} title="방 삭제 (방장 전용)">
                🗑️ 방 삭제
              </button>
            </>
          )}

          <button className="btn-leave" onClick={handleExit} title="방 나가기">
            🚪 나가기
          </button>
        </div>
      </div>

      {/* Room Main Split Layout (좌: MemberList, 우: ChatLog) */}
      <div className="room-split-body">
        <MemberList roomId={roomId} />

        <section className="room-chat-section">
          <ChatLog />

          <div className="chat-input-container">
            <form className="chat-input-row" onSubmit={handleSend}>
              <input
                ref={inputRef}
                type="text"
                className="chat-input"
                placeholder="메시지를 입력하세요 (@멘션, Ctrl+V 이미지 붙여넣기 지원)..."
                maxLength={500}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onClick={(e) =>
                  updateMentionState(input, (e.target as HTMLInputElement).selectionStart ?? input.length)
                }
                onKeyUp={(e) =>
                  updateMentionState(input, (e.target as HTMLInputElement).selectionStart ?? input.length)
                }
                onCompositionStart={() => {
                  isComposingRef.current = true
                  setMentionQuery(null)
                }}
                onCompositionEnd={handleCompositionEnd}
              />
              <button type="submit" className="btn-chat-send" disabled={!input.trim() || uploading}>
                {uploading ? '업로드 중...' : '전송'}
              </button>

              {mentionQuery !== null && mentionCandidates.length > 0 && (
                <div className="mention-popover" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 20 }}>
                  <div className="mention-popover-title" style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 8px' }}>
                    멘션 — Tab/Enter로 선택
                  </div>
                  <ul className="mention-popover-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {mentionCandidates.map((c, idx) => (
                      <li
                        key={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applyMention(c)
                        }}
                        style={{
                          padding: '6px 8px',
                          fontSize: 13,
                          cursor: 'pointer',
                          display: 'flex',
                          gap: 6,
                          alignItems: 'center',
                          background: idx === mentionIndex ? 'var(--bg-card)' : 'transparent',
                        }}
                      >
                        <span style={{ color: 'var(--brand-yellow)' }}>@</span>
                        <span className="mention-name" style={{ color: 'var(--text-main)' }}>{c}</span>
                        {(c === 'everyone' || c === 'all') && (
                          <span
                            className="mention-badge"
                            style={{
                              fontSize: 10,
                              marginLeft: 'auto',
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: 'var(--brand-yellow)',
                            }}
                          >
                            전체
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
            <div className="chat-hints">Tip: @ 입력 시 파티원 멘션 자동완성 · 클립보드 이미지 복사 후 붙여넣기 가능</div>
          </div>
        </section>
      </div>

      {/* Bottom Always-Visible VoiceBar */}
      <VoiceBar />

      <InviteModal roomId={currentRoom.id} isOpen={showInvite} onClose={() => setShowInvite(false)} />
      <EditRoomModal
        room={currentRoom}
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        onUpdated={(updated) => {
          useRoomStore.setState({ currentRoom: updated })
        }}
      />
    </div>
  )
}