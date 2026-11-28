import { describe, expect, it, beforeEach } from 'vitest'
import { getStoredUid, getStoredSecret, saveSessionCredentials } from './uid'

describe('uid storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns empty strings before the server issues credentials', () => {
    expect(getStoredUid()).toBe('')
    expect(getStoredSecret()).toBe('')
  })

  it('saves server-issued uid and secret', () => {
    saveSessionCredentials('u-1', 's-1')
    expect(getStoredUid()).toBe('u-1')
    expect(getStoredSecret()).toBe('s-1')
  })
})
