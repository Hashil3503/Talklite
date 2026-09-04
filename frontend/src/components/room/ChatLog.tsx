import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRoomStore, type ChatMessage } from '../../store/roomStore'

export const ChatLog: React.FC = () => {
  const messages = useRoomStore((state) => state.messages)
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

  // 새 메시지 수신 시 하단 자동 스크롤
  useEffect(() => {
    if (messages.length > 0) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages.length, rowVirtualizer])

  const handleImageLoad = useCallback(() => {
    // 가상화 겹침 방지: 이미지 로드 후 동적 높이 재계산
    try {
      // @ts-ignore tanstack 3.x measure() 존재, 일부 타입에서 누락될 수 있음
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

  return (
    <>
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#121217]/60"
        style={{ contain: 'strict' }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
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
              const isMentioned =
                Array.isArray(msg.mentions) && msg.mentions.includes(currentUserId) && msg.sender !== currentUserId
              const isImage = msg.type === 'IMAGE' && !!msg.mediaUrl

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
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} px-1 py-1`}
                >
                  <div className="flex items-baseline space-x-2 mb-1">
                    <span className="text-xs font-semibold text-zinc-400">{msg.senderName || msg.sender}</span>
                    <span className="text-[10px] text-zinc-600">
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMentioned && <span className="text-[10px] text-amber-400 font-semibold">@멘션</span>}
                  </div>
                  <div
                    className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                      isMe
                        ? 'bg-gradient-to-r from-[#10B981] to-[#50C2F3] text-black rounded-br-none'
                        : isMentioned
                          ? 'bg-amber-900/60 text-amber-100 border border-amber-600/40 rounded-bl-none'
                          : 'bg-[#171720] text-zinc-200 rounded-bl-none'
                    } ${isImage ? 'min-h-[160px] p-2' : ''}`}
                  >
                    {isImage ? (
                      <div className="space-y-1">
                        {msg.content && <div className="px-1 py-1 text-sm">{msg.content}</div>}
                        {msg.mediaUrl && failedImages.has(msg.mediaUrl) ? (
                          <div role="img" aria-label="이미지를 불러오지 못했습니다" className="flex min-h-24 min-w-40 items-center justify-center rounded-lg border border-red-900/60 bg-zinc-900 px-4 text-center text-xs text-red-300">
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
                            className="max-w-[260px] max-h-[320px] w-auto h-auto rounded-lg object-contain cursor-zoom-in bg-zinc-900 border border-zinc-700"
                          />
                        )}
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.status === 'pending' && <span className="text-[10px] text-zinc-500 mt-0.5">전송 중...</span>}
                  {msg.status === 'failed' && <span className="text-[10px] text-red-400 mt-0.5">전송 실패</span>}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          {lightboxFailed ? (
            <div role="img" aria-label="이미지를 불러오지 못했습니다" className="rounded-xl border border-red-900/60 bg-zinc-900 px-6 py-10 text-sm text-red-300">
              이미지를 불러오지 못했습니다.
            </div>
          ) : (
            <img
              src={lightboxUrl}
              alt="확대 이미지"
              onError={() => setLightboxFailed(true)}
              onClick={(e) => e.stopPropagation()}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl border border-zinc-700"
            />
          )}
          <button
            ref={lightboxCloseRef}
            onClick={() => setLightboxUrl(null)}
            aria-label="닫기"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center text-lg border border-zinc-700"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
