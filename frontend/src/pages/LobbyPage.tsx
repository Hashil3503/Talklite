import { useEffect, useState } from 'react'
import { RoomCard } from '../components/RoomCard'
import { SearchBar } from '../components/SearchBar'
import { useLobbyStore } from '../store/lobbyStore'
import { useToastStore } from '../store/toastStore'
import { createRoom, joinWithInviteCode, joinRoom, type RoomScope, type RoomType } from '../lib/api'
import { subscribeTopic } from '../lib/stomp'
import { getOrCreateAnonymousId } from '../lib/uid'

interface LobbyPageProps {
  onJoinRoom: (roomId: string) => void
}

export function LobbyPage({ onJoinRoom }: LobbyPageProps) {
  const { rooms, loading, error, search } = useLobbyStore()
  const showToast = useToastStore((state) => state.showToast)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

  // 방 만들기 폼 상태
  const [title, setTitle] = useState('')
  const [game, setGame] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [capacity, setCapacity] = useState(5)
  const [scope, setScope] = useState<RoomScope>('PUBLIC')
  const [type, setType] = useState<RoomType>('TEMPORARY')

  // 초대코드 입장 상태
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const getCurrentUserId = () => getOrCreateAnonymousId()

  useEffect(() => {
    search('', [])

    // 실시간 로비 갱신 구독 — ROOM_UPDATED는 증분 갱신, 그 외는 전체 재검색
    const sub = subscribeTopic('/topic/lobby', (message) => {
      try {
        const raw: any = JSON.parse((message as any).body ?? '{}')
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (body && body.type === 'ROOM_UPDATED') {
          useLobbyStore.getState().handleRoomUpdated(body)
          return
        }
      } catch {}
      search('', [])
    })

    return () => {
      sub.unsubscribe()
    }
  }, [search])

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!game.trim()) return

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)

    try {
      const room = await createRoom({
        title: title.trim() || undefined,
        game: game.trim(),
        tags,
        capacity,
        scope,
        type,
        host: getCurrentUserId(),
      })
      setShowCreateModal(false)
      onJoinRoom(room.id)
    } catch (err: any) {
      showToast(err.message || '방 생성에 실패했습니다.', 'error')
    }
  }

  const handleJoinByInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteCodeInput.trim()) return
    setInviteError(null)

    try {
      const room = await joinWithInviteCode(inviteCodeInput.trim().toUpperCase(), getCurrentUserId())
      setShowInviteModal(false)
      onJoinRoom(room.id)
    } catch (err: any) {
      setInviteError(err.message || '초대코드 입장에 실패했습니다.')
    }
  }

  const handleSelectRoom = async (roomId: string) => {
    try {
      await joinRoom(roomId, getCurrentUserId())
      onJoinRoom(roomId)
    } catch (err: any) {
      showToast(err.message || '방 입장에 실패했습니다.', 'error')
    }
  }

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-zinc-100 px-4 sm:px-6 py-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setShowInviteModal(true)}
          className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#121217] px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-[rgba(255,255,255,0.2)]"
        >
          🔑 초대코드로 입장
        </button>
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-xl bg-gradient-to-r from-[#FF371A] to-[#8B5CF6] px-4 py-2 text-sm font-bold text-white transition-transform hover:scale-105 shadow-lg shadow-[#FF371A]/20"
        >
          + 파티 생성
        </button>
      </div>

      <SearchBar />

      {loading && <p className="text-center text-zinc-500 py-8">검색 중...</p>}
      {error && <p className="text-center text-[#FF371A] py-4">{error}</p>}

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} onSelect={handleSelectRoom} />
          ))}
        </div>
      )}

      {!loading && rooms.length === 0 && (
        <div className="text-center py-16 space-y-3 bento-surface">
          <p className="text-zinc-500">개설된 공개 방이 없습니다.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-sm font-semibold text-[#50C2F3] hover:underline"
          >
            지금 첫 번째 방을 만들어보세요!
          </button>
        </div>
      )}

      {/* 방 만들기 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bento-elevated max-w-md w-full p-6 space-y-5 shadow-2xl bg-[#171720]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">🎮 새 파티 방 만들기</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-500 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">방 제목 (선택, 최대 50자)</label>
                <input
                  type="text"
                  maxLength={50}
                  placeholder="예: 다이아 랭크 즐겜팟 (미입력 시 [게임명] 파티)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">게임명 *</label>
                <input
                  type="text"
                  required
                  placeholder="예: 롤, 발로란트, 오버워치"
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">태그 (쉼표로 구분, 최대 5개)</label>
                <input
                  type="text"
                  placeholder="예: 칼바람, 즐겜, 실버, 마이크필수"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">정원 (2~6명)</label>
                  <select
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                  >
                    {[2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}명
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">공개 범위</label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as RoomScope)}
                    className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                  >
                    <option value="PUBLIC">공개 (로비 노출)</option>
                    <option value="PRIVATE">비공개 (초대코드 전용)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">방 유지 유형</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as RoomType)}
                  className="w-full px-3.5 py-2.5 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                >
                  <option value="TEMPORARY">휘발성 (0명 퇴장 시 자동 소멸)</option>
                  <option value="PERMANENT">영구 방 (보존)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#121217] hover:bg-[#0B0B0E] text-sm font-semibold text-zinc-300 border border-[rgba(255,255,255,0.08)] transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#10B981] to-[#50C2F3] text-sm font-bold text-black transition-colors"
                >
                  생성하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 초대코드로 입장 모달 */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bento-elevated max-w-sm w-full p-6 space-y-4 shadow-2xl bg-[#171720]">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">🔑 초대코드로 입장</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-zinc-500 hover:text-white">
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400">전달받은 6자리 비공개 방 초대코드를 입력하세요.</p>

            <form onSubmit={handleJoinByInvite} className="space-y-4">
              <div>
                <input
                  type="text"
                  maxLength={6}
                  required
                  placeholder="예: 7K2M9X"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 bg-[#0B0B0E] border border-[rgba(255,255,255,0.08)] rounded-xl text-center text-xl font-mono tracking-widest text-[#50C2F3] uppercase placeholder-zinc-600 focus:outline-none focus:border-[rgba(80,194,243,0.5)]"
                />
              </div>

              {inviteError && <p className="text-xs text-center text-[#FF371A]">{inviteError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#121217] hover:bg-[#0B0B0E] text-sm font-semibold text-zinc-300 border border-[rgba(255,255,255,0.08)] transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#10B981] to-[#50C2F3] text-sm font-bold text-black transition-colors"
                >
                  입장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}