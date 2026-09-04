import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { ToastContainer } from './components/common/Toast'
import { FloatingVoiceWidget } from './components/voice/FloatingVoiceWidget'
import { LobbyPage } from './pages/LobbyPage'
import { RoomPage } from './pages/RoomPage'
import { createSession, leaveRoom } from './lib/api'
import { setSessionToken } from './lib/stomp'
import { getOrCreateAnonymousId } from './lib/uid'
import { useRoomStore } from './store/roomStore'
import { useVoiceStore } from './store/voiceStore'

export type ActiveView = 'LOBBY' | 'ROOM'

export function App() {
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('room')
  })
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    new URLSearchParams(window.location.search).get('room') ? 'ROOM' : 'LOBBY'
  )
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

  // 세션 토큰 초기화
  useEffect(() => {
    const uid = getOrCreateAnonymousId()
    createSession(uid)
      .then((res) => {
        localStorage.setItem('talklite_token', res.token)
        localStorage.setItem('talklite_token_expires_at', String(Date.now() + res.expiresIn * 1000))
        setSessionToken(res.token)
      })
      .catch((err) => {
        console.warn('Failed to auto-create session:', err)
      })
  }, [])

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
    useVoiceStore.getState().leaveVoice()
    if (roomId) {
      try {
        await leaveRoom(roomId, getOrCreateAnonymousId())
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

      {activeView === 'LOBBY' ? (
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

      {activeView === 'LOBBY' && isInVoice && <FloatingVoiceWidget onReturnToRoom={handleGotoRoom} />}

      <ToastContainer />
    </div>
  )
}

export default App