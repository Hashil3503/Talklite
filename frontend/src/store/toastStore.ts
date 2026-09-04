import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  duration: number
}

interface ToastState {
  toasts: ToastItem[]
  showToast: (message: string, type?: ToastType, duration?: number) => void
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, type = 'info', duration = 3000) => {
    const id = nextToastId++
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, message, type, duration }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))