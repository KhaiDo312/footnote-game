import { describe, expect, it } from 'vitest'
import { canStart, startState } from './start-rules'

describe('startState', () => {
  it('waits while the index is building', () => {
    expect(startState({ indexStatus: 'indexing', indexFailures: 0 })).toBe('waiting')
    expect(canStart({ indexStatus: 'indexing' })).toBe(false)
  })

  it('is ready once the index is built', () => {
    expect(startState({ indexStatus: 'ready' })).toBe('ready')
    expect(canStart({ indexStatus: 'ready' })).toBe(true)
  })

  it('offers only Retry after the first failure', () => {
    expect(startState({ indexStatus: 'failed', indexFailures: 1 })).toBe('retry')
    expect(canStart({ indexStatus: 'failed', indexFailures: 1 })).toBe(false)
  })

  it('offers "Start anyway" after the second failure', () => {
    expect(startState({ indexStatus: 'failed', indexFailures: 2 })).toBe('start-anyway')
    expect(canStart({ indexStatus: 'failed', indexFailures: 2 })).toBe(true)
  })

  it('goes back to waiting while a retry is indexing, even after failures', () => {
    expect(startState({ indexStatus: 'indexing', indexFailures: 2 })).toBe('waiting')
  })

  it('treats rooms from before this field existed as ready', () => {
    expect(startState({})).toBe('ready')
  })
})
