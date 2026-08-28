import { useEffect, useState } from 'react'
import { RoomCard } from '../components/RoomCard'
import { SearchBar } from '../components/SearchBar'
import { useLobbyStore } from '../store/lobbyStore'
import { createRoom, joinWithInviteCode, joinRoom, type RoomScope, type RoomType } from '../lib/api'
import { subscribeTopic } from '../lib/stomp'
import { getOrCreateAnonymousId } from '../lib/uid'

interface LobbyPageProps {
  onJoinRoom: (roomId: string) => void
}

export function LobbyPage({ onJoinRoom }: LobbyPageProps) {
  const { rooms, loading, error, search } = useLobbyStore()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

  // 방 만들기 폼 상태
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
      alert(err.message || '방 생성에 실패했습니다.')
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
      alert(err.message || '방 입장에 실패했습니다.')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8 space-y-8 max-w-6xl mx-auto">
      {/* 헤더 & 상단 액션 */}
      <header className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h1 className="text-3xl font-extrabold text-emerald-400 tracking-tight">Talklite</h1>
          <p className="text-sm text-neutral-500">온디맨드 게이머 즉석 파티 매칭 & 오픈 보이스</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 transition-colors"
          >
            🔑 초대코드로 입장
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-lg shadow-emerald-600/20"
          >
            + 새 방 만들기
          </button>
        </div>
      </header>

      <SearchBar />

      {loading && <p className="text-center text-neutral-500 py-8">검색 중...</p>}
      {error && <p className="text-center text-rose-400 py-4">{error}</p>}

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} onSelect={handleSelectRoom} />
          ))}
        </div>
      )}

      {!loading && rooms.length === 0 && (
        <div className="text-center py-16 space-y-3 bg-neutral-900/30 rounded-2xl border border-neutral-800/60">
          <p className="text-neutral-500">개설된 공개 방이 없습니다.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-sm font-semibold text-emerald-400 hover:underline"
          >
            지금 첫 번째 방을 만들어보세요!
          </button>
        </div>
      )}

      {/* 방 만들기 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">🎮 새 파티 방 만들기</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-neutral-500 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1.5">게임명 *</label>
                <input
                  type="text"
                  required
                  placeholder="예: 롤, 발로란트, 오버워치"
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1.5">태그 (쉼표로 구분, 최대 5개)</label>
                <input
                  type="text"
                  placeholder="예: 칼바람, 즐겜, 실버, 마이크필수"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 mb-1.5">정원 (2~10명)</label>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-400 mb-1.5">공개 범위</label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as RoomScope)}
                    className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="PUBLIC">공개 (로비 노출)</option>
                    <option value="PRIVATE">비공개 (초대코드 전용)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1.5">방 유지 유형</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as RoomType)}
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="TEMPORARY">휘발성 (0명 퇴장 시 자동 소멸)</option>
                  <option value="PERMANENT">영구 방 (보존)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold text-neutral-300 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors"
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
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">🔑 초대코드로 입장</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-neutral-500 hover:text-white">✕</button>
            </div>

            <p className="text-xs text-neutral-400">
              전달받은 6자리 비공개 방 초대코드를 입력하세요.
            </p>

            <form onSubmit={handleJoinByInvite} className="space-y-4">
              <div>
                <input
                  type="text"
                  maxLength={6}
                  required
                  placeholder="예: 7K2M9X"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-center text-xl font-mono tracking-widest text-emerald-400 uppercase placeholder-neutral-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {inviteError && <p className="text-xs text-center text-rose-400">{inviteError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold text-neutral-300 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors"
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
