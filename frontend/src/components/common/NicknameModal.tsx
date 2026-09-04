import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUserStore } from '../../store/userStore'
import { useToastStore } from '../../store/toastStore'

interface NicknameModalProps {
  isOpen: boolean
  onClose: () => void
}

export const NicknameModal: React.FC<NicknameModalProps> = ({ isOpen, onClose }) => {
  const nickname = useUserStore((state) => state.nickname)
  const setNickname = useUserStore((state) => state.setNickname)
  const showToast = useToastStore((state) => state.showToast)
  const [value, setValue] = useState(nickname)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setValue(useUserStore.getState().nickname)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      showToast('닉네임은 2자 이상 입력해 주세요.', 'error')
      return
    }
    setNickname(trimmed)
    showToast(`닉네임이 '${trimmed}'(으)로 변경되었습니다.`, 'success')
    onClose()
  }

  // createPortal(document.body) — 헤더 backdrop-filter/sticky의 컨테이닝 블록에 갇히지 않아
  // 뷰포트 기준 fixed 배치가 보장되어 상단 잘림 현상을 원천 차단한다.
  return createPortal(
    <div
      className="modal-overlay active"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{ margin: 'auto', maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">✏️ 닉네임 설정</h3>
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            &times;
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          파티 및 채팅에서 표시될 닉네임을 입력하세요 (2~12자).
        </p>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <input
              ref={inputRef}
              className="form-input"
              placeholder="예: 페이커미드"
              maxLength={12}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn-primary">
              저장하기
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}