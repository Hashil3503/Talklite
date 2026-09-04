import React, { useEffect, useRef } from 'react'
import { useVoiceStore } from '../../store/voiceStore'

const VU_STEPS = 20
const GRADIENT = ['#10B981', '#22c55e', '#50C2F3', '#8B5CF6', '#f59e0b', '#ff371a']

function segColor(i: number, total: number): string {
  const ratio = i / total
  const idx = Math.min(GRADIENT.length - 1, Math.floor(ratio * GRADIENT.length))
  return GRADIENT[idx]
}

/**
 * P0-06 단일 구독 원칙: Zustand `useVoiceStore.subscribe` + DOM ref 직접 갱신 패턴.
 * 신규 AnalyserNode/rAF 생성 금지 — VoiceBar/FloatingVoiceWidget이 공용으로 사용한다.
 */
export const VuMeter: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const segments = Array.from(container.querySelectorAll<HTMLDivElement>('[data-vu-seg]'))
    let previousActive = -1

    const update = (level: number): void => {
      const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
      const active = Math.round(normalized * VU_STEPS)
      if (active === previousActive) return
      previousActive = active
      for (let i = 0; i < segments.length; i++) {
        segments[i].style.opacity = i < active ? '1' : '0.14'
      }
      container.setAttribute('aria-valuenow', String(Math.round(normalized * 100)))
      container.setAttribute('aria-valuetext', `${Math.round(normalized * 100)}%`)
    }

    update(useVoiceStore.getState().micVolumeLevel)
    return useVoiceStore.subscribe((state) => update(state.micVolumeLevel))
  }, [])

  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1'

  return (
    <div
      ref={containerRef}
      role="meter"
      aria-label="마이크 VU 레벨"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-valuetext="0%"
      className={`flex items-center ${gap} w-full`}
    >
      {Array.from({ length: VU_STEPS }, (_, i) => (
        <div
          key={i}
          data-vu-seg
          className={`flex-1 rounded-sm ${size === 'sm' ? 'h-1.5' : 'h-2'}`}
          style={{ backgroundColor: segColor(i, VU_STEPS), opacity: 0.14 }}
        />
      ))}
    </div>
  )
}