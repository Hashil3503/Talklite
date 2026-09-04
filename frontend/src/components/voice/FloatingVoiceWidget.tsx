import React, { useRef, useState } from 'react'
import { useVoiceStore } from '../../store/voiceStore'
import { VuMeter } from './VuMeter'

interface FloatingVoiceWidgetProps {
  onReturnToRoom: () => void
}

const CARD_WIDTH = 256
const CARD_HEIGHT = 160
const EDGE_PADDING = 8
const DRAG_THRESHOLD = 5

interface Pos {
  x: number
  y: number
}

/**
 * P0-06: 로비 둘러보기 중 통화 지속 표시 카드 (bottom-28 right-6, 토스트 3스택 겹침 방지).
 * VU는 공용 VuMeter(subscribe + ref DOM) 재사용 — 신규 rAF/Analyser 금지.
 * 드래그: Pointer Events + setPointerCapture, 5px 임계값으로 클릭과 구분.
 * 드래그 중 "테이블에서 카드를 들어올린 듯" scale/rotate/그림자 강조.
 */
export const FloatingVoiceWidget: React.FC<FloatingVoiceWidgetProps> = ({ onReturnToRoom }) => {
  const isMuted = useVoiceStore((state) => state.isMuted)
  const voiceMembers = useVoiceStore((state) => state.voiceMembers)
  const toggleMute = useVoiceStore((state) => state.toggleMute)

  const [pos, setPos] = useState<Pos | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; cardLeft: number; cardTop: number } | null>(null)
  const hasDraggedRef = useRef(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = e.currentTarget
    const rect = card.getBoundingClientRect()
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      cardLeft: rect.left,
      cardTop: rect.top,
    }
    hasDraggedRef.current = false
    card.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    const dx = e.clientX - start.pointerX
    const dy = e.clientY - start.pointerY
    // 5px 임계값 초과 시에만 드래그 전환 (이하이면 기존 클릭 동작 유지)
    if (!hasDraggedRef.current && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return
    hasDraggedRef.current = true
    setDragging(true)
    const nextX = start.cardLeft + dx
    const nextY = start.cardTop + dy
    // 화면 밖으로 완전히 벗어나지 않도록 클램프
    const clampedX = Math.min(Math.max(nextX, EDGE_PADDING), window.innerWidth - CARD_WIDTH - EDGE_PADDING)
    const clampedY = Math.min(Math.max(nextY, EDGE_PADDING), window.innerHeight - CARD_HEIGHT - EDGE_PADDING)
    setPos({ x: clampedX, y: clampedY })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handlePointerCancel = (_e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null
    setDragging(false)
  }

  // 드래그로 끝난 제스처의 클릭은 버블링 차단 (Mute/복귀 버튼 클릭 보호)
  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDraggedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      hasDraggedRef.current = false
    }
  }

  const cardStyle: React.CSSProperties = {
    touchAction: 'none',
    ...(pos ? { left: pos.x, top: pos.y } : {}),
    ...(dragging
      ? {
          transform: 'scale(1.05) rotate(1.2deg)',
          boxShadow: '0 24px 48px -12px rgba(0,0,0,0.8), 0 12px 24px rgba(0,0,0,0.6)',
          borderColor: 'rgba(255,255,255,0.2)',
          transition: 'none',
          cursor: 'grabbing',
          userSelect: 'none',
          zIndex: 50,
        }
      : {
          transform: undefined,
          boxShadow: undefined,
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
          cursor: 'grab',
        }),
  }

  return (
    <div
      className={`fixed bottom-28 right-6 z-40 w-64 rounded-2xl border border-[rgba(255,255,255,0.12)] ${
        dragging ? 'bg-[#1E1E2A]/95' : 'bg-[#171720]/95'
      } p-3 shadow-2xl shadow-black/60 backdrop-blur-md select-none`}
      style={cardStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold text-[#10B981]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          통화 중 · {voiceMembers.length}명
        </span>
        <button
          onClick={toggleMute}
          title={isMuted ? '마이크 켜기' : '마이크 음소거'}
          aria-label={isMuted ? '마이크 켜기' : '마이크 음소거'}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
            isMuted ? 'bg-[#FF371A]/25 text-[#FF371A]' : 'bg-[#0B0B0E] text-zinc-300 hover:bg-[#121217]'
          }`}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400">VU 레벨</span>
          <span className="text-[10px] text-zinc-500">{isMuted ? '음소거' : '라이브'}</span>
        </div>
        <VuMeter size="sm" />
      </div>

      <button
        onClick={onReturnToRoom}
        className="w-full rounded-xl bg-gradient-to-r from-[#10B981] to-[#50C2F3] px-3 py-2 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.02]"
      >
        🎙️ 보이스 룸 복귀
      </button>
    </div>
  )
}