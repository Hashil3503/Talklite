import React, { useState, useEffect } from 'react'
import { getInviteCode } from '../../lib/api'
import { useToastStore } from '../../store/toastStore'

interface InviteModalProps {
  roomId: string
  isOpen: boolean
  onClose: () => void
}

export const InviteModal: React.FC<InviteModalProps> = ({ roomId, isOpen, onClose }) => {
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const showToast = useToastStore((state) => state.showToast)

  const currentUserId = localStorage.getItem('talklite_uid') || ''

  useEffect(() => {
    if (isOpen && roomId) {
      setLoading(true)
      setError(null)
      getInviteCode(roomId, currentUserId)
        .then((res) => setCode(res.code))
        .catch((err) => setError(err.message || '초대코드를 불러오지 못했습니다.'))
        .finally(() => setLoading(false))
    }
  }, [isOpen, roomId, currentUserId])

  if (!isOpen) return null

  const handleCopy = () => {
    if (code) {
      navigator.clipboard
        .writeText(code)
        .then(() => showToast(`초대코드가 복사되었습니다: ${code}`, 'success'))
        .catch(() => showToast('클립보드 복사에 실패했습니다.', 'error'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            🔒 비공개 방 초대코드
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        <p className="text-xs text-zinc-400">
          초대코드를 공유하여 친구를 비공개 방에 즉시 초대하세요. (유효기간 24시간)
        </p>

        {loading ? (
          <div className="py-6 text-center text-sm text-zinc-500">코드 발급 중...</div>
        ) : error ? (
          <div className="py-4 text-center text-sm text-red-400">{error}</div>
        ) : (
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center justify-between">
            <span className="font-mono text-2xl font-black tracking-widest text-blue-400 select-all">
              {code}
            </span>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#50C2F3]/15 hover:bg-[#50C2F3]/25 text-[#50C2F3] border border-[rgba(80,194,243,0.35)] transition-colors"
            >
              코드 복사
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-200 transition-colors"
        >
          닫기
        </button>
      </div>
    </div>
  )
}
