import React, { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRoomStore, type ChatMessage } from '../../store/roomStore'

export const ChatLog: React.FC = () => {
  const messages = useRoomStore((state) => state.messages)
  const currentUserId = localStorage.getItem('talklite_uid') || ''
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 64,
    overscan: 5,
  })

  // 새 메시지 수신 시 하단 자동 스크롤
  useEffect(() => {
    if (messages.length > 0) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages.length, rowVirtualizer])

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-900/50 rounded-xl border border-zinc-800"
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

            return (
              <div
                key={virtualRow.key}
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
                  <span className="text-xs font-semibold text-zinc-400">
                    {msg.senderName || msg.sender}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div
                  className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-zinc-800 text-zinc-200 rounded-bl-none'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.status === 'pending' && (
                  <span className="text-[10px] text-zinc-500 mt-0.5">전송 중...</span>
                )}
                {msg.status === 'failed' && (
                  <span className="text-[10px] text-red-400 mt-0.5">전송 실패</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
