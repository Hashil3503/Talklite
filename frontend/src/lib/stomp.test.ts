import { describe, expect, it } from 'vitest'
import { shouldPromptRefresh } from './stomp'

describe('shouldPromptRefresh', () => {
  it('does not prompt when the server instance is seen for the first time', () => {
    expect(shouldPromptRefresh(null, 'instance-a')).toBe(false)
  })

  it('does not prompt when the instance id is unchanged', () => {
    expect(shouldPromptRefresh('instance-a', 'instance-a')).toBe(false)
  })

  it('prompts when the instance id changed after a server restart', () => {
    expect(shouldPromptRefresh('instance-a', 'instance-b')).toBe(true)
  })
})
