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
import { getOrCreateAnonymousId } from '../lib/uid'

interface RoomPageProps {
  roomId: string
  onGotoLobby: () => void
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

export const RoomPage: React.FC<RoomPageProps> = ({ roomId, onGotoLobby, onExit, onKicked }) => {
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
    // 필터
    let filtered = base.filter((m) => m.toLowerCase().includes(q))
    // everyone/all 후보 추가
    for (const s of specials) {
      if (s.includes(q) && !filtered.includes(s)) filtered.push(s)
    }
    if (q === '') {
      // 빈 쿼리일 때 멤버 + everyone/all 모두 노출 (최대 8)
      const extras = specials.filter((s) => !filtered.includes(s))
      filtered = [...filtered, ...extras]
    }
    return filtered.slice(0, 8)
  }, [mentionQuery, currentRoom])

  const updateMentionState = useCallback(
    (value: string, caret: number) => {
      const before = value.slice(0, caret)
      // \B@([A-Za-z0-9._가-힣]{0,30})$ 형태 감지
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
      // caret 복원
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

  // REMOTE_EJECT: currentRoom이 원격 소멸/강퇴로 null이 되면 로비로 (RoomPage가 계속 마운트된 경우 방어)
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
      <div className="h-screen bg-[#0B0B0E] flex items-center justify-center text-zinc-400">방에 접속 중입니다...</div>
    )
  }

  return (
    <div className="h-screen bg-[#0B0B0E] text-zinc-100 flex flex-col overflow-hidden">
      <header className="h-16 px-4 sm:px-6 border-b border-[rgba(255,255,255,0.08)] bg-[#121217]/60 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3 min-w-0">
          <button
            onClick={onGotoLobby}
            className="shrink-0 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171720] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:text-white hover:border-[rgba(255,255,255,0.2)]"
          >
            ← 로비로
          </button>
          <div className="h-4 w-px bg-[rgba(255,255,255,0.08)]" />
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">
              {(currentRoom as any).title || currentRoom.game}
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#0B0B0E] text-zinc-400 border border-[rgba(255,255,255,0.08)]">
                {currentRoom.game}
              </span>
              {currentRoom.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#0B0B0E] text-zinc-500">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => void copyInviteCode()}
            disabled={!inviteCode}
            title="6자리 초대코드 복사"
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[rgba(80,194,243,0.35)] bg-[#50C2F3]/10 px-3 py-1.5 text-xs font-semibold text-[#50C2F3] transition-colors hover:bg-[#50C2F3]/20 disabled:opacity-50"
          >
            🔑 {inviteCode ?? '로딩 중'}
          </button>

          {currentRoom.scope === 'PRIVATE' && (
            <button
              onClick={() => setShowInvite(true)}
              className="sm:hidden px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#171720] hover:bg-[#121217] text-zinc-200 border border-[rgba(255,255,255,0.1)] transition-colors"
            >
              🔒 초대코드
            </button>
          )}

          {currentRoom.host === currentUserId && (
            <>
              <button
                onClick={() => setShowEdit(true)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#171720] hover:bg-[#121217] text-zinc-200 border border-[rgba(255,255,255,0.1)] transition-colors flex items-center gap-1"
              >
                <span>⚙️ 방 설정</span>
              </button>
              <button
                onClick={handleDeleteRoom}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#FF371A]/10 hover:bg-[#FF371A]/20 text-[#FF371A] border border-[rgba(255,55,26,0.35)] transition-colors flex items-center gap-1"
              >
                <span>🗑️ 방 삭제</span>
              </button>
            </>
          )}

          <button
            onClick={handleExit}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#FF371A]/20 hover:bg-[#FF371A]/30 text-[#FF371A] border border-[rgba(255,55,26,0.4)] transition-colors"
          >
            🚪 방 나가기
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden p-4 sm:p-6 gap-4 sm:gap-6 max-w-7xl w-full mx-auto">
        <main className="flex-1 flex flex-col overflow-hidden gap-4">
          <ChatLog />

          <form onSubmit={handleSend} className="flex gap-2 shrink-0 relative">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onClick={(e) => updateMentionState(input, (e.target as HTMLInputElement).selectionStart ?? input.length)}
                onKeyUp={(e) => updateMentionState(input, (e.target as HTMLInputElement).selectionStart ?? input.length)}
                onCompositionStart={() => {
                  isComposingRef.current = true
                  setMentionQuery(null)
                }}
                onCompositionEnd={handleCompositionEnd}
                placeholder="메시지를 입력하세요... (Enter로 전송, @로 멘션, Ctrl+V로 이미지 붙여넣기)"
                maxLength={500}
                className="w-full px-4 py-3 bg-[#121217] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[rgba(80,194,243,0.5)] transition-colors"
              />
              {mentionQuery !== null && mentionCandidates.length > 0 && (
                <div className="absolute bottom-12 left-0 w-64 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#171720] shadow-2xl overflow-hidden z-20">
                  <div className="px-3 py-2 text-[11px] text-zinc-500 border-b border-[rgba(255,255,255,0.08)]">
                    멘션 — Tab/Enter로 선택
                  </div>
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {mentionCandidates.map((c, idx) => (
                      <li
                        key={c}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applyMention(c)
                        }}
                        className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                          idx === mentionIndex ? 'bg-[#121217] text-white' : 'text-zinc-300 hover:bg-[#121217]/60'
                        }`}
                      >
                        <span className="text-amber-400">@</span>
                        <span className="truncate">{c}</span>
                        {(c === 'everyone' || c === 'all') && (
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700">
                            전체
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!input.trim() || uploading}
              className="px-6 py-3 bg-gradient-to-r from-[#10B981] to-[#50C2F3] hover:opacity-90 disabled:opacity-40 disabled:hover:opacity-40 text-black text-sm font-bold rounded-xl transition-opacity shadow-lg shadow-emerald-500/20 shrink-0"
            >
              {uploading ? '업로드 중...' : '전송'}
            </button>
          </form>
        </main>

        <aside className="h-full flex shrink-0">
          <MemberList />
        </aside>
      </div>

      <InviteModal roomId={currentRoom.id} isOpen={showInvite} onClose={() => setShowInvite(false)} />
      <EditRoomModal
        room={currentRoom}
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        onUpdated={(updated) => {
          // 즉시 로컬 반영 (STOMP 전파 전 UX)
          useRoomStore.setState({ currentRoom: updated })
        }}
      />

      <VoiceBar roomId={roomId} />
    </div>
  )
}