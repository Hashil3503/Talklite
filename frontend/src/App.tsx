import { useState, useEffect } from 'react'
import { LobbyPage } from './pages/LobbyPage'
import { RoomPage } from './pages/RoomPage'
import { createSession } from './lib/api'
import { setSessionToken } from './lib/stomp'
import { getOrCreateAnonymousId } from './lib/uid'

export function App() {
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('room')
  })

  // 세션 토큰 초기화
  useEffect(() => {
    const uid = getOrCreateAnonymousId()
    const storedToken = localStorage.getItem('talklite_token')

    if (!storedToken) {
      createSession(uid).then((res) => {
        localStorage.setItem('talklite_token', res.token)
        setSessionToken(res.token)
      }).catch((err) => {
        console.warn('Failed to auto-create session:', err)
      })
    } else {
      setSessionToken(storedToken)
    }
  }, [])

  // URL 동기화
  const handleJoinRoom = (roomId: string) => {
    setCurrentRoomId(roomId)
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomId)
    window.history.pushState({}, '', url)
  }

  const handleLeaveRoom = () => {
    setCurrentRoomId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.pushState({}, '', url)
  }

  if (currentRoomId) {
    return <RoomPage roomId={currentRoomId} onLeave={handleLeaveRoom} />
  }

  return <LobbyPage onJoinRoom={handleJoinRoom} />
}

export default App
