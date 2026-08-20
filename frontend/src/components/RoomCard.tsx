import type { RoomResponse } from '../lib/api'

export function RoomCard({ room }: { room: RoomResponse }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-emerald-400">{room.game}</h3>
        <span className="text-xs text-neutral-500">
          {room.count}/{room.capacity}
        </span>
      </div>
      {room.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {room.tags.map((tag) => (
            <span key={tag} className="text-xs bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded-full">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-500">{room.host}</p>
    </div>
  )
}
