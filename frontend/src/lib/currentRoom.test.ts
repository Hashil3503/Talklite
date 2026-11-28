import { beforeEach, describe, expect, it } from 'vitest'
import { getInitialRoomId, saveCurrentRoomId } from './currentRoom'

describe('current room persistence', () => {
  beforeEach(() => sessionStorage.clear())

  it('prefers ?room= in the URL', () => {
    saveCurrentRoomId('stored')
    expect(getInitialRoomId('?room=from-url')).toBe('from-url')
  })

  it('falls back to the room kept in tab storage after a lobby refresh', () => {
    saveCurrentRoomId('room-1')
    expect(getInitialRoomId('')).toBe('room-1')
  })

  it('returns null after leaving the room', () => {
    saveCurrentRoomId('room-1')
    saveCurrentRoomId(null)
    expect(getInitialRoomId('')).toBeNull()
  })
})
