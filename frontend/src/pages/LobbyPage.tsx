import { useEffect, useState } from 'react'
import { RoomCard } from '../components/RoomCard'
import { SearchBar } from '../components/SearchBar'
import { useLobbyStore, type SortKey, type SortOrder } from '../store/lobbyStore'
import { useToastStore } from '../store/toastStore'
import { createRoom, joinWithInviteCode, joinRoom, type RoomScope, type RoomType } from '../lib/api'
import { subscribeTopic } from '../lib/stomp'
import { getOrCreateAnonymousId } from '../lib/uid'

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: '최신순', value: 'latest-desc' },
  { label: '오래된순', value: 'latest-asc' },
  { label: '제목 오름차순', value: 'title-asc' },
  { label: '제목 내림차순', value: 'title-desc' },
  { label: '인원 오름차순', value: 'members-asc' },
  { label: '인원 내림차순', value: 'members-desc' },
]

const GAME_SUGGESTIONS = ['리그 오브 레전드', 'Valorant', 'PUBG', 'Overwatch 2']

interface LobbyPageProps {
  onJoinRoom: (roomId: string) => void
  showCreateModal?: boolean
  setShowCreateModal?: (open: boolean) => void
  showInviteModal?: boolean
  setShowInviteModal?: (open: boolean) => void
}

export function LobbyPage({
  onJoinRoom,
  showCreateModal,
  setShowCreateModal,
  showInviteModal,
  setShowInviteModal,
}: LobbyPageProps) {
  const { rooms, loading, sort, order, setSort, setOrder, search } = useLobbyStore()
  const showToast = useToastStore((state) => state.showToast)

  // 내부/외부(Header) 공용 모달 상태 — props 미지원 시 로컬 폴백
  const [localCreate, setLocalCreate] = useState(false)
  const [localInvite, setLocalInvite] = useState(false)
  const createOpen = showCreateModal ?? localCreate
  const inviteOpen = showInviteModal ?? localInvite
  const openCreate = () => (setShowCreateModal ? setShowCreateModal(true) : setLocalCreate(true))
  const closeCreate = () => (setShowCreateModal ? setShowCreateModal(false) : setLocalCreate(false))
  const closeInvite = () => (setShowInviteModal ? setShowInviteModal(false) : setLocalInvite(false))

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
      closeCreate()
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
      closeInvite()
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

  const sortedValue = `${sort}-${order}`

  return (
    <div className="view-container" id="view-lobby">
      <div className="container">
        {/* Lobby Search & Hero Filter Area */}
        <section className="lobby-hero">
          <h1 className="lobby-title">
            원하는 게임 파티를 찾고 <span className="gradient-text">즉시 음성에 참여하세요</span>
          </h1>
          <p className="lobby-subtitle">디스코드 설치 없이 웹에서 1초 만에 연결되는 온디맨드 게이밍 보이스</p>
          <SearchBar />
        </section>

        {/* Lobby Live Room Cards Grid */}
        <section className="room-grid-section">
          <div className="section-header-row">
            <div className="status-indicator">
              <span className="pulse-dot" />
              <span>
                실시간 모집 중인 방 (<strong>{rooms.length}개</strong>)
              </span>
            </div>
            <div className="sort-select-wrap">
              <select
                className="select-sort"
                value={sortedValue}
                aria-label="정렬 기준"
                onChange={(e) => {
                  const [s, o] = e.target.value.split('-')
                  setSort(s as SortKey)
                  setOrder(o as SortOrder)
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading && <p className="text-center text-muted py-8">검색 중...</p>}

          {!loading && (
            <div className="room-grid" id="lobby-room-grid">
              {rooms.map((room) => (
                <RoomCard key={room.id} room={room} onSelect={handleSelectRoom} />
              ))}
            </div>
          )}

          {!loading && rooms.length === 0 && (
            <div className="room-card" style={{ minHeight: 'auto', cursor: 'default', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>개설된 공개 방이 없습니다.</p>
              <button className="btn-secondary-sm" onClick={openCreate}>
                지금 첫 번째 방을 만들어보세요!
              </button>
            </div>
          )}
        </section>
      </div>

      {/* 방 만들기 모달 (목업 구조) */}
      <div className={`modal-overlay ${createOpen ? 'active' : ''}`} onClick={closeCreate}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3 className="modal-title">🎮 새 파티 만들기</h3>
            <button className="modal-close" onClick={closeCreate} aria-label="닫기">
              &times;
            </button>
          </div>

          <form id="create-room-form" onSubmit={handleCreateRoom}>
            <div className="form-group">
              <label className="form-label" htmlFor="form-game">
                게임 선택 <span className="req">*</span>
              </label>
              <input
                id="form-game"
                className="form-input"
                list="form-game-suggestions"
                placeholder="예: 리그 오브 레전드, Valorant, PUBG, Overwatch 2"
                value={game}
                onChange={(e) => setGame(e.target.value)}
                required
              />
              <datalist id="form-game-suggestions">
                {GAME_SUGGESTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="form-title">
                방 제목 <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(선택, 미입력 시 [게임명] 파티)</span>
              </label>
              <input
                id="form-title"
                className="form-input"
                maxLength={50}
                placeholder="예: [다이아] 승급전 정글 구합니다 (보이스 필수, 즐겜)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label className="form-label" htmlFor="form-capacity">
                  최대 정원 (2~6인)
                </label>
                <select
                  id="form-capacity"
                  className="form-select"
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                >
                  <option value="2">2명 (듀오)</option>
                  <option value="3">3명 (트리오)</option>
                  <option value="4">4명 (스쿼드)</option>
                  <option value="5">5명 (팀 파티)</option>
                  <option value="6">6명 (최대 정원)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="form-scope">
                  공개 범위
                </label>
                <select
                  id="form-scope"
                  className="form-select"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as RoomScope)}
                >
                  <option value="PUBLIC">공개방</option>
                  <option value="PRIVATE">비공개 (초대코드 전용)</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="form-tags">
                태그 (쉼표로 구분, 최대 5개)
              </label>
              <input
                id="form-tags"
                className="form-input"
                placeholder="예: 랭크, 다이아, 빡겜, 마이크필수"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>

            <div className="form-group">
              <span className="form-label">방 유형</span>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="roomType"
                    value="TEMPORARY"
                    checked={type === 'TEMPORARY'}
                    onChange={() => setType('TEMPORARY')}
                  />
                  <span>휘발성 방 (전원 퇴장 시 자동 소멸)</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="roomType"
                    value="PERMANENT"
                    checked={type === 'PERMANENT'}
                    onChange={() => setType('PERMANENT')}
                  />
                  <span>영구 방 (대화 영속화 & 방장 고아 자동 승계)</span>
                </label>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={closeCreate}>
                취소
              </button>
              <button type="submit" className="btn-primary">
                방 생성하고 입장하기 &rarr;
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 초대코드로 입장 모달 (목업 구조) */}
      <div className={`modal-overlay ${inviteOpen ? 'active' : ''}`} onClick={closeInvite}>
        <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3 className="modal-title">🔑 초대코드로 입장</h3>
            <button className="modal-close" onClick={closeInvite} aria-label="닫기">
              &times;
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            전달받은 6자리 비공개 방 초대코드를 입력하세요. (유효기간 24시간)
          </p>

          <form id="invite-join-form" onSubmit={handleJoinByInvite}>
            <div className="form-group">
              <input
                className="form-input"
                maxLength={6}
                placeholder="예: TL-8492"
                style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: 2, textAlign: 'center' }}
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                required
              />
            </div>

            {inviteError && (
              <p style={{ fontSize: 12, textAlign: 'center', color: 'var(--brand-primary)', marginBottom: 4 }}>{inviteError}</p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={closeInvite}>
                취소
              </button>
              <button type="submit" className="btn-primary">
                입장하기
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}