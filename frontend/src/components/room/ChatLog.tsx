import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRoomStore, type ChatMessage } from '../../store/roomStore'

function renderMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[A-Za-z0-9._가-힣]{1,30})/g)
  return parts.map((part, i) => {
    if (/^@[A-Za-z0-9._가-힣]{1,30}$/.test(part)) {
      return (
        <span key={i} className="mention-tag">
          {part}
        </span>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

export const ChatLog: React.FC = () => {
  const messages = useRoomStore((state) => state.messages)
  const currentRoom = useRoomStore((state) => state.currentRoom)
  const currentUserId = localStorage.getItem('talklite_uid') || ''
  const parentRef = useRef<HTMLDivElement>(null)
  const lightboxCloseRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxFailed, setLightboxFailed] = useState(false)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  })

  useEffect(() => {
    if (messages.length > 0) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages.length, rowVirtualizer])

  const handleImageLoad = useCallback(() => {
    try {
      if (typeof (rowVirtualizer as unknown as { measure: () => void }).measure === 'function') {
        ;(rowVirtualizer as unknown as { measure: () => void }).measure()
      } else {
        rowVirtualizer.measure()
      }
    } catch {}
  }, [rowVirtualizer])

  const markImageFailed = useCallback((mediaUrl: string) => {
    setFailedImages((current) => {
      const next = new Set(current)
      next.add(mediaUrl)
      return next
    })
  }, [])

  useEffect(() => {
    if (!lightboxUrl) return
    setLightboxFailed(false)
    lightboxCloseRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setLightboxUrl(null)
        return
      }
      if (e.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('[data-lightbox-dialog]')
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [lightboxUrl])

  const roomTitle = currentRoom?.title || currentRoom?.game || ''

  return (
    <>
      <div ref={parentRef} className="chat-log-container">
        <div className="chat-system-message">
          🎉 {roomTitle} 파티에 입장했습니다. 음성 세션이 자동으로 활성화되었습니다.
        </div>

        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, padding: '24px 0' }}>
            아직 대화가 없습니다. 첫 메시지를 남겨보세요!
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg: ChatMessage = messages[virtualRow.index]
              const isMe = msg.sender === currentUserId
              const isHost = !!currentRoom && msg.sender === currentRoom.host
              const isMentioned =
                Array.isArray(msg.mentions) && msg.mentions.includes(currentUserId) && msg.sender !== currentUserId
              const isImage = msg.type === 'IMAGE' && !!msg.mediaUrl
              const avatarChar = (msg.senderName || msg.sender).charAt(0).toUpperCase() || '?'

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className={`chat-item ${isMentioned ? 'mentioned' : ''}`}>
                    <div className="chat-avatar">{avatarChar}</div>
                    <div className="chat-content">
                      <div className="chat-header-meta">
                        <span className={`chat-author ${isHost ? 'host' : ''}`}>
                          {msg.senderName || msg.sender}
                          {isHost ? ' 👑' : ''}
                          {isMe ? ' (나)' : ''}
                        </span>
                        <span className="chat-time">
                          {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isMentioned && <span style={{ color: 'var(--brand-primary)', fontSize: 11, fontWeight: 600 }}>@멘션</span>}
                      </div>

                      <div className="chat-text">
                        {isImage ? (
                          <div className="chat-image-preview">
                            {msg.content && <p>{msg.content}</p>}
                            {msg.mediaUrl && failedImages.has(msg.mediaUrl) ? (
                              <div
                                role="img"
                                aria-label="이미지를 불러오지 못했습니다"
                                className="image-mock-box"
                                style={{ color: 'var(--brand-primary)' }}
                              >
                                이미지를 불러오지 못했습니다.
                              </div>
                            ) : (
                              <img
                                src={msg.mediaUrl ?? undefined}
                                alt={msg.content || '채팅 이미지'}
                                loading="lazy"
                                onLoad={handleImageLoad}
                                onError={() => msg.mediaUrl && markImageFailed(msg.mediaUrl)}
                                onClick={() => {
                                  if (!msg.mediaUrl) return
                                  previousFocusRef.current = document.activeElement as HTMLElement | null
                                  setLightboxFailed(false)
                                  setLightboxUrl(msg.mediaUrl)
                                }}
                                style={{ maxWidth: 260, maxHeight: 320, borderRadius: 8, cursor: 'zoom-in', border: '1px solid var(--border-color)' }}
                              />
                            )}
                          </div>
                        ) : (
                          renderMentions(msg.content)
                        )}
                      </div>

                      {msg.status === 'pending' && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>전송 중...</span>
                      )}
                      {msg.status === 'failed' && (
                        <span style={{ fontSize: 10, color: 'var(--brand-primary)' }}>전송 실패</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {lightboxUrl && (
        <div
          data-lightbox-dialog
          role="dialog"
          aria-modal="true"
          aria-label="이미지 확대 보기"
          onClick={() => setLightboxUrl(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
        >
          {lightboxFailed ? (
            <div role="img" aria-label="이미지를 불러오지 못했습니다" className="image-mock-box" style={{ color: 'var(--brand-primary)' }}>
              이미지를 불러오지 못했습니다.
            </div>
          ) : (
            <img
              src={lightboxUrl}
              alt="확대 이미지"
              onError={() => setLightboxFailed(true)}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.8)', border: '1px solid var(--border-color)' }}
            />
          )}
          <button
            ref={lightboxCloseRef}
            onClick={() => setLightboxUrl(null)}
            aria-label="닫기"
            className="btn-action"
            style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, fontSize: 18 }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}