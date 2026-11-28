import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { ToastContainer } from './components/common/Toast'
import { FloatingVoiceWidget } from './components/voice/FloatingVoiceWidget'
import { LobbyPage } from './pages/LobbyPage'
import { RoomPage } from './pages/RoomPage'
import { createSession, getRoom, joinRoom, leaveRoom } from './lib/api'
import { getInitialRoomId, saveCurrentRoomId } from './lib/currentRoom'
import { setSessionToken } from './lib/stomp'
import { getStoredSecret, getStoredUid, saveSessionCredentials } from './lib/uid'
import { useRoomStore } from './store/roomStore'
import { useUserStore } from './store/userStore'
import { useVoiceStore } from './store/voiceStore'

export type ActiveView = 'LOBBY' | 'ROOM'

export function App() {
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(() => getInitialRoomId(window.location.search))
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    new URLSearchParams(window.location.search).get('room') ? 'ROOM' : 'LOBBY'
  )
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  // 서버 발급 UID가 준비되기 전에는 로비/방을 렌더링하지 않는다
  const [sessionReady, setSessionReady] = useState(false)

  // 세션 토큰 초기화 — 서버가 UID/비밀값을 발급하고, 이후 모든 화면은 그 UID를 사용한다
  useEffect(() => {
    const storedUid = getStoredUid()
    createSession(storedUid || undefined, getStoredSecret() || undefined)
      .then((res) => {
        localStorage.setItem('talklite_token', res.token)
        localStorage.setItem('talklite_token_expires_at', String(Date.now() + res.expiresIn * 1000))
        setSessionToken(res.token)
        if (res.user !== storedUid || res.secret) {
          saveSessionCredentials(res.user, res.secret)
          useUserStore.getState().setUid(res.user)
        }
      })
      .catch((err) => {
        console.warn('Failed to auto-create session:', err)
      })
      .finally(() => setSessionReady(true))
  }, [])

  // 참여 중인 방을 탭 저장소에 기억 — 로비 화면에서 새로고침해도 방 참여가 유지되도록
  useEffect(() => {
    saveCurrentRoomId(currentRoomId)
  }, [currentRoomId])

  // 로비 화면에서 새로고침한 경우: 방 화면은 열지 않고 방 연결(구독)만 다시 맺어 T-H4 유예 퇴장을 막는다
  useEffect(() => {
    if (!sessionReady || activeView !== 'LOBBY' || !currentRoomId) return
    if (useRoomStore.getState().currentRoom?.id === currentRoomId) return
    const roomId = currentRoomId
    joinRoom(roomId, getStoredUid())
      .catch(() => getRoom(roomId)) // 비공개 방은 재입장 대신 멤버 조회
      .then((room) => {
        if (!room.members.includes(getStoredUid())) throw new Error('not a member') // 강퇴된 공개 방
        useRoomStore.getState().setCurrentRoom(room)
      })
      .catch(() => setCurrentRoomId(null)) // 방이 사라졌거나 강퇴됨
    // 최초 복원만 담당 — 화면 전환 시에는 다시 실행하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady])

  // P0-01: 비정상 단절(beforeunload/pagehide) 시 음성 리소스 정리 (STOMP Presence가 Redis 잔류 자동 정리)
  useEffect(() => {
    const handlePageHide = (): void => {
      useVoiceStore.getState().forceDisconnectVoice()
    }
    window.addEventListener('beforeunload', handlePageHide)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('beforeunload', handlePageHide)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  const syncUrl = (roomId: string | null) => {
    const url = new URL(window.location.href)
    if (roomId) url.searchParams.set('room', roomId)
    else url.searchParams.delete('room')
    window.history.pushState({}, '', url)
  }

  // JOIN_ROOM (LOBBY -> ROOM, WebRTC/STOMP 세션 유지)
  const handleJoinRoom = (roomId: string) => {
    const previousRoomId = currentRoomId
    if (previousRoomId && previousRoomId !== roomId) {
      // 다른 방으로 갈아타면 이전 방에서 바로 나간다 (같은 연결이 살아 있어 T-H4 유예 퇴장이 동작하지 않음)
      useVoiceStore.getState().leaveVoice(true)
      void leaveRoom(previousRoomId, getStoredUid()).catch(() => {
        // 이미 소멸된 방은 무시
      })
    }
    setCurrentRoomId(roomId)
    setActiveView('ROOM')
    syncUrl(roomId)
  }

  // GOTO_LOBBY (ROOM -> LOBBY, 세션 유지 — 세션 API 호출 금지)
  const handleGotoLobby = () => {
    setActiveView('LOBBY')
    syncUrl(null)
  }

  // GOTO_ROOM (LOBBY -> ROOM, 세션 유지)
  const handleGotoRoom = () => {
    if (!currentRoomId) return
    setActiveView('ROOM')
    syncUrl(currentRoomId)
  }

  // EXIT_ROOM: 단일 teardown — leaveVoice() -> leaveRoom(API) -> setCurrentRoom(null) 순서 고정
  const handleExplicitExit = async () => {
    const roomId = currentRoomId
    // 방 완전 퇴장 — 통화 종료 알림음은 울리지 않도록 silent
    useVoiceStore.getState().leaveVoice(true)
    if (roomId) {
      try {
        await leaveRoom(roomId, getStoredUid())
      } catch {
        // 404 등 이미 소멸된 방은 무시
      }
    }
    useRoomStore.getState().setCurrentRoom(null)
    setCurrentRoomId(null)
    setActiveView('LOBBY')
    syncUrl(null)
  }

  // REMOTE_EJECT (ROOM_DESTROYED/MEMBER_KICKED) — force 경로는 roomStore가 이미 수행
  const handleRemoteEject = () => {
    setCurrentRoomId(null)
    setActiveView('LOBBY')
    syncUrl(null)
  }

  // Header "+ 방 만들기" — 룸 뷰에서 클릭 시 로비로 전환 후 모달 오픈
  const handleOpenCreateModal = () => {
    if (activeView === 'ROOM') {
      setActiveView('LOBBY')
      syncUrl(null)
    }
    setShowCreateModal(true)
  }

  // Header "초대코드 입력" — 룸 뷰에서 클릭 시 로비로 전환 후 모달 오픈
  const handleOpenInviteModal = () => {
    if (activeView === 'ROOM') {
      setActiveView('LOBBY')
      syncUrl(null)
    }
    setShowInviteModal(true)
  }

  const roomTitle = currentRoom?.title || currentRoom?.game || null

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-zinc-100">
      <Header
        activeView={activeView}
        isInRoom={!!currentRoomId}
        roomTitle={roomTitle}
        onSwitchView={(view) => (view === 'ROOM' ? handleGotoRoom() : handleGotoLobby())}
        onCreateRoom={handleOpenCreateModal}
        onOpenInvite={handleOpenInviteModal}
      />

      {!sessionReady ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-400">Loading…</div>
      ) : activeView === 'LOBBY' ? (
        <LobbyPage
          onJoinRoom={handleJoinRoom}
          showCreateModal={showCreateModal}
          setShowCreateModal={setShowCreateModal}
          showInviteModal={showInviteModal}
          setShowInviteModal={setShowInviteModal}
        />
      ) : (
        currentRoomId && (
          <RoomPage
            roomId={currentRoomId}
            onExit={() => void handleExplicitExit()}
            onKicked={handleRemoteEject}
          />
        )
      )}

      {sessionReady && activeView === 'LOBBY' && isInVoice && (
        <FloatingVoiceWidget onReturnToRoom={handleGotoRoom} />
      )}

      <ToastContainer />
    </div>
  )
}

export default App