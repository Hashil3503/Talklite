import React from 'react'
import { useToastStore } from '../../store/toastStore'

const TYPE_STYLES: Record<string, { icon: string; ring: string }> = {
  info: { icon: 'ℹ️', ring: 'border-cyan-400/40' },
  success: { icon: '✅', ring: 'border-emerald-400/40' },
  warning: { icon: '⚠️', ring: 'border-amber-400/40' },
  error: { icon: '⛔', ring: 'border-red-400/50' },
}

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts)
  const dismissToast = useToastStore((state) => state.dismissToast)

  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map((toast) => {
        const style = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismissToast(toast.id)}
            className={`pointer-events-auto flex items-center gap-2 rounded-xl border ${style.ring} bg-[#171720] px-4 py-2.5 text-sm text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur-sm transition-all animate-[toast-in_0.2s_ease]`}
            style={{ maxWidth: '320px' }}
          >
            <span aria-hidden="true">{style.icon}</span>
            <span className="text-left leading-snug break-words">{toast.message}</span>
          </button>
        )
      })}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  )
}