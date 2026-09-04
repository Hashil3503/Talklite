import React from 'react'
import type { ActiveView } from '../App'

interface HeaderProps {
  activeView: ActiveView
  isInRoom: boolean
  roomTitle?: string | null
  onSwitchView: (view: ActiveView) => void
  onExit: () => void
  onCreateRoom: () => void
  onOpenInvite: () => void
}

export const Header: React.FC<HeaderProps> = ({ activeView, isInRoom, roomTitle, onSwitchView, onExit, onCreateRoom, onOpenInvite }) => {
  const uid = localStorage.getItem('talklite_uid') || 'anonymous'
  const shortUid = `${uid.slice(0, 4)}${uid.length > 4 ? '…' : ''}`

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
        <div className="user-profile-badge">
          <div className="user-avatar-sm" aria-hidden="true">
            U
          </div>
          <span className="user-name">{uid.slice(0, 6)}</span>
          <span className="user-uid">#{shortUid}</span>
        </div>

        <button className="btn-secondary-sm" onClick={onOpenInvite}>
          초대코드 입력
        </button>
        <button className="btn-primary-sm" onClick={onCreateRoom}>
          + 방 만들기
        </button>

        {isInRoom && (
          <button className="btn-leave" onClick={onExit}>
            🚪 나가기
          </button>
        )}
      </div>
    </header>
  )
}