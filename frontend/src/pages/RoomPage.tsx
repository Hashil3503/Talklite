import React, { useState, useEffect } from 'react'
import { useRoomStore } from '../store/roomStore'
import { ChatLog } from '../components/room/ChatLog'
import { MemberList } from '../components/room/MemberList'
import { InviteModal } from '../components/room/InviteModal'
import { leaveRoom, getRoom } from '../lib/api'

interface RoomPageProps {
  roomId: string
  onLeave: () => void
}

export const RoomPage: React.FC<RoomPageProps> = ({ roomId, onLeave }) => {
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const setCurrentRoom = useRoomStore((state) => state.setCurrentRoom)
  const sendChat = useRoomStore((state) => state.sendChat)

  const [input, setInput] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [loading, setLoading] = useState(false)
  const currentUserId = localStorage.getItem('talklite_uid') || ''

  useEffect(() => {
    if (!currentRoom || currentRoom.id !== roomId) {
      setLoading(true)
      getRoom(roomId)
        .then((room) => setCurrentRoom(room))
        .catch((err) => {
          alert(err.message || '방 정보를 불러오지 못했습니다.')
          onLeave()
        })
        .finally(() => setLoading(false))
    }
  }, [roomId, currentRoom, setCurrentRoom, onLeave])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    sendChat(input)
    setInput('')
  }

  const handleExit = async () => {
    if (confirm('방에서 나가시겠습니까?')) {
      try {
        await leaveRoom(roomId, currentUserId)
      } catch {}
      setCurrentRoom(null)
      onLeave()
    }
  }

  if (loading || !currentRoom) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        방에 접속 중입니다...
      </div>
    )
  }

  return (
    <div className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* 방 헤더 */}
      <header className="h-16 px-6 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={handleExit}
            className="text-zinc-400 hover:text-white text-sm font-medium transition-colors"
          >
            ← 로비로
          </button>
          <div className="h-4 w-px bg-zinc-800" />
          <h1 className="text-lg font-bold tracking-tight">{currentRoom.game}</h1>
          <div className="flex items-center gap-1.5">
            {currentRoom.tags.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {currentRoom.scope === 'PRIVATE' && (
            <button
              onClick={() => setShowInvite(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors flex items-center gap-1.5"
            >
              <span>🔒 초대코드</span>
            </button>
          )}

          <button
            onClick={handleExit}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/40 transition-colors"
          >
            방 나가기
          </button>
        </div>
      </header>

      {/* 본문: 채팅창 + 사이드바 */}
      <div className="flex-1 flex overflow-hidden p-6 gap-6 max-w-7xl w-full mx-auto">
        <main className="flex-1 flex flex-col overflow-hidden gap-4">
          <ChatLog />

          <form onSubmit={handleSend} className="flex gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요... (Enter로 전송)"
              maxLength={500}
              className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/20 shrink-0"
            >
              전송
            </button>
          </form>
        </main>

        <aside className="h-full flex shrink-0">
          <MemberList />
        </aside>
      </div>

      <InviteModal
        roomId={currentRoom.id}
        isOpen={showInvite}
        onClose={() => setShowInvite(false)}
      />
    </div>
  )
}
