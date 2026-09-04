import type { RoomResponse } from '../lib/api'

interface RoomCardProps {
  room: RoomResponse
  onSelect?: (roomId: string) => void
  voiceCount?: number
}

export function RoomCard({ room, onSelect, voiceCount = 0 }: RoomCardProps) {
  const title = room.title || `[${room.game}] 파티`
  return (
    <div
      onClick={() => onSelect && onSelect(room.id)}
      className="bento-surface bento-card-hover p-5 space-y-3 cursor-pointer group flex flex-col justify-between"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#50C2F3] group-hover:text-[#8B5CF6] transition-colors truncate">
            {title}
          </h3>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#0B0B0E] text-zinc-400 border border-[rgba(255,255,255,0.08)] shrink-0">
            {room.count}/{room.capacity}명
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#0B0B0E] text-zinc-400 border border-[rgba(255,255,255,0.08)]">
            {room.game}
          </span>
          {room.type === 'PERMANENT' && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-violet-950/40 text-[#8B5CF6] border border-violet-500/30">
              ⭐ 영구방
            </span>
          )}
        </div>

        {voiceCount > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 text-[#10B981] border border-emerald-800/60 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            🎙️ 통화 중 ({voiceCount}명)
          </div>
        )}

        {room.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {room.tags.map((tag) => (
              <span key={tag} className="text-xs bg-[#0B0B0E] text-zinc-400 px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.06)]">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.06)] text-xs text-zinc-500">
        <span>
          방장: <strong className="text-zinc-400 font-medium">{room.host}</strong>
        </span>
        {room.scope === 'PRIVATE' && <span className="text-amber-400 font-semibold">🔒 비공개</span>}
      </div>
    </div>
  )
}
