import type { RoomResponse } from '../lib/api'

interface RoomCardProps {
  room: RoomResponse
  onSelect?: (roomId: string) => void
  voiceCount?: number
}

/** 게임명 → 목업 badge-game 동적 클래스 매핑 (lol/val/pubg/ow) */
function gameBadgeClass(game: string): string {
  const g = game.toLowerCase()
  if (g.includes('legend') || g.includes('리그') || g.includes('롤')) return 'lol'
  if (g.includes('val') || g.includes('발로')) return 'val'
  if (g.includes('pubg') || g.includes('배그') || g.includes('배틀')) return 'pubg'
  if (g.includes('overwatch') || g.includes('오버워치') || g.includes('옵치')) return 'ow'
  return ''
}

export function RoomCard({ room, onSelect, voiceCount = 0 }: RoomCardProps) {
  const title = room.title || `[${room.game}] 파티`
  return (
    <div
      className="room-card"
      data-room-id={room.id}
      data-game={room.game}
      onClick={() => onSelect && onSelect(room.id)}
    >
      <div className="room-card-header">
        <span className={`badge-game ${gameBadgeClass(room.game)}`}>{room.game}</span>
        <span className="room-capacity-badge">
          <span className="dot-green" />
          {room.count} / {room.capacity}명
        </span>
      </div>

      <h3 className="room-title">👑 {title}</h3>

      <div className="room-tags">
        {room.tags.map((tag) => (
          <span key={tag} className="tag-pill">
            #{tag}
          </span>
        ))}
        {voiceCount > 0 && (
          <span className="tag-pill active-voice">🎙️ 보이스 활성 ({voiceCount}명)</span>
        )}
      </div>

      <div className="room-card-footer">
        <div className="host-info">
          <span className="host-crown">👑</span>
          <span className="host-name">{room.host}</span>
        </div>
        {room.scope === 'PRIVATE' ? (
          <span className="badge-scope private">🔒 비공개</span>
        ) : room.type === 'PERMANENT' ? (
          <span className="badge-scope permanent">영구방 ⭐</span>
        ) : (
          <span className="badge-scope public">공개방</span>
        )}
      </div>
    </div>
  )
}