import React, { useEffect, useState } from 'react'
import { updateRoom, type RoomResponse, ApiError } from '../../lib/api'

interface EditRoomModalProps {
  room: RoomResponse | null
  isOpen: boolean
  onClose: () => void
  onUpdated?: (room: RoomResponse) => void
}

export const EditRoomModal: React.FC<EditRoomModalProps> = ({ room, isOpen, onClose, onUpdated }) => {
  const [title, setTitle] = useState('')
  const [game, setGame] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [capacity, setCapacity] = useState(4)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen && room) {
      setTitle((room as any).title ?? '')
      setGame(room.game ?? '')
      setTags([...(room.tags ?? [])])
      setCapacity(room.capacity ?? 4)
      setError(null)
      setTagInput('')
    }
  }, [isOpen, room])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !room) return null

  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (tags.includes(t)) {
      setTagInput('')
      return
    }
    if (tags.length >= 5) {
      setError('태그는 최대 5개까지 가능합니다')
      return
    }
    setTags([...tags, t])
    setTagInput('')
    setError(null)
  }

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!game.trim()) {
      setError('게임명을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const updated = await updateRoom(room.id, {
        title: title.trim() || undefined,
        game: game.trim(),
        tags,
        capacity,
      })
      onUpdated?.(updated)
      onClose()
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'room_capacity_conflict') {
        setError('정원이 현재 인원보다 작아 변경할 수 없습니다 (409 정원 충돌)')
      } else if (err instanceof ApiError && err.status === 409) {
        setError(err.message || '정원 충돌로 변경할 수 없습니다')
      } else {
        setError(err.message || '방 수정에 실패했습니다')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-room-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 id="edit-room-modal-title" className="text-base font-bold text-white flex items-center gap-2">⚙️ 방 설정 수정</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">방 제목</label>
            <input
              type="text"
              autoFocus
              maxLength={50}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 다이아 랭크 즐겜팟 (선택)"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">게임명 *</label>
            <input
              type="text"
              required
              maxLength={128}
              value={game}
              onChange={(e) => setGame(e.target.value)}
              placeholder="예: 리그 오브 레전드"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">해시태그 (최대 5개, Enter로 추가)</label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-xs text-zinc-200 border border-zinc-700"
                >
                  #{t}
                  <button type="button" onClick={() => removeTag(t)} className="text-zinc-500 hover:text-white ml-1">
                    ✕
                  </button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-xs text-zinc-600">등록된 태그 없음</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="태그 입력 후 Enter"
                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-300 border border-zinc-700"
              >
                추가
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">최대 정원 (2~6명)</label>
            <select
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}명
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500 mt-1">현재 인원보다 작게 줄이면 409 정원 충돌 에러가 발생합니다</p>
          </div>

          {error && <div className="rounded-xl bg-red-950/40 border border-red-800/50 px-3 py-2 text-xs text-red-300">{error}</div>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-300 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
            >
              {saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
