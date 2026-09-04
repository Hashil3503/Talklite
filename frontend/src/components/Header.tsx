import React, { useState } from 'react'
import type { ActiveView } from '../App'
import { useUserStore } from '../store/userStore'
import { NicknameModal } from './common/NicknameModal'

interface HeaderProps {
  activeView: ActiveView
  isInRoom: boolean
  roomTitle?: string | null
  onSwitchView: (view: ActiveView) => void
  onCreateRoom: () => void
  onOpenInvite: () => void
}

export const Header: React.FC<HeaderProps> = ({ activeView, isInRoom, roomTitle, onSwitchView, onCreateRoom, onOpenInvite }) => {
  const displayName = useUserStore((state) => state.displayName)
  const avatarInitial = useUserStore((state) => state.avatarInitial)
  const shortUid = useUserStore((state) => state.shortUid)
  const [showNicknameModal, setShowNicknameModal] = useState(false)

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="app-logo" title="Talklite">
          <div className="logo-badge" aria-hidden="true">
            🎙️
          </div>
          <span className="logo-text">Talklite</span>
        </div>

        <div className="view-switcher" role="tablist" aria-label="뷰 전환">
          <button
            role="tab"
            aria-selected={activeView === 'LOBBY'}
            className={`view-tab ${activeView === 'LOBBY' ? 'active' : ''}`}
            onClick={() => onSwitchView('LOBBY')}
          >
            🎮 파티 로비
          </button>
          <button
            role="tab"
            aria-selected={activeView === 'ROOM'}
            className={`view-tab ${activeView === 'ROOM' ? 'active' : ''}`}
            disabled={!isInRoom}
            onClick={() => onSwitchView('ROOM')}
          >
            🎙️ 보이스 룸{isInRoom && roomTitle ? ` · ${roomTitle}` : ''}
          </button>
        </div>
      </div>

      <div className="header-right">
        <button
          className="user-profile-badge"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowNicknameModal(true)}
          title="클릭하여 닉네임 변경"
        >
          <div className="user-avatar-sm" aria-hidden="true">
            {avatarInitial}
          </div>
          <span className="user-name">{displayName}</span>
          <span className="user-uid">#{shortUid}</span>
        </button>

        <button className="btn-secondary-sm" onClick={onOpenInvite}>
          초대코드 입력
        </button>
        <button className="btn-primary-sm" onClick={onCreateRoom}>
          + 방 만들기
        </button>
      </div>

      <NicknameModal isOpen={showNicknameModal} onClose={() => setShowNicknameModal(false)} />
    </header>
  )
}