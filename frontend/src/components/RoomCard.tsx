import type { RoomResponse } from '../lib/api'

interface RoomCardProps {
  room: RoomResponse
  onSelect?: (roomId: string) => void
  voiceCount?: number
}

export function RoomCard({ room, onSelect, voiceCount = 0 }: RoomCardProps) {
  return (
    <div
      onClick={() => onSelect && onSelect(room.id)}
      className="bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 space-y-3 cursor-pointer transition-all duration-200 shadow-lg hover:shadow-neutral-950/50 group flex flex-col justify-between"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-emerald-400 group-hover:text-emerald-300 transition-colors">
            {room.game}
          </h3>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
            {room.count}/{room.capacity}명
          </span>
        </div>

        {voiceCount > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            🎙️ 통화 중 ({voiceCount}명)
          </div>
        )}

        {room.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {room.tags.map((tag) => (
              <span key={tag} className="text-xs bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded-full">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60 text-xs text-neutral-500">
        <span>방장: <strong className="text-neutral-400 font-medium">{room.host}</strong></span>
        {room.scope === 'PRIVATE' && <span className="text-amber-400 font-semibold">🔒 비공개</span>}
      </div>
    </div>
  )
}
