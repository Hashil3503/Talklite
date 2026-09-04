import { create } from 'zustand'
import { getOrCreateAnonymousId } from '../lib/uid'

const NICKNAME_KEY = 'talklite_nickname'

interface UserState {
  nickname: string
  uid: string
  displayName: string
  avatarInitial: string
  shortUid: string
  setNickname: (name: string) => void
}

function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) || ''
  } catch {
    return ''
  }
}

function derive(nickname: string, uid: string) {
  const displayName = nickname.trim() || uid.slice(0, 6)
  return {
    displayName,
    avatarInitial: displayName.slice(0, 1).toUpperCase() || 'U',
    shortUid: uid.slice(0, 4),
  }
}

const initialUid = getOrCreateAnonymousId()
const initialNickname = loadNickname()

export const useUserStore = create<UserState>((set) => ({
  nickname: initialNickname,
  uid: initialUid,
  ...derive(initialNickname, initialUid),

  setNickname: (name) => {
    const trimmed = name.trim()
    const { uid } = useUserStore.getState()
    try {
      if (trimmed) localStorage.setItem(NICKNAME_KEY, trimmed)
      else localStorage.removeItem(NICKNAME_KEY)
    } catch {
      // ignore
    }
    set({ nickname: trimmed, ...derive(trimmed, uid) })
  },
}))