import { useEffect } from 'react'
import { RoomCard } from '../components/RoomCard'
import { SearchBar } from '../components/SearchBar'
import { useLobbyStore } from '../store/lobbyStore'

export function LobbyPage() {
  const { rooms, loading, error, search } = useLobbyStore()

  useEffect(() => {
    search('', [])
  }, [search])

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8 space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-emerald-400">Talklite</h1>
        <p className="text-sm text-neutral-500">온디맨드 게이머 파티 매칭</p>
      </header>
      <SearchBar />
      {loading && <p className="text-center text-neutral-500">검색 중...</p>}
      {error && <p className="text-center text-rose-400">{error}</p>}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
      {!loading && rooms.length === 0 && (
        <p className="text-center text-neutral-600">방이 없습니다.</p>
      )}
    </div>
  )
}
