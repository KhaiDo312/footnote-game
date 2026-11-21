import { describe, expect, it } from 'vitest'
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from './config'
import { makeJoinCode, normalizeJoinCode } from './join-code'

describe('makeJoinCode', () => {
  it('makes a code of the right length using only allowed letters', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeJoinCode()
      expect(code).toHaveLength(JOIN_CODE_LENGTH)
      for (const letter of code) expect(JOIN_CODE_ALPHABET).toContain(letter)
    }
  })

  it('never uses the confusing letters O, I or L', () => {
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[OIL]/)
  })

  it('uses the random source it is given', () => {
    expect(makeJoinCode(() => 0)).toBe('AAAAA')
    expect(makeJoinCode((max) => max - 1)).toBe('ZZZZZ')
  })
})

describe('normalizeJoinCode', () => {
  it('accepts lowercase and surrounding spaces', () => {
    expect(normalizeJoinCode('  kqxtr ')).toBe('KQXTR')
  })

  it('rejects the wrong length', () => {
    expect(normalizeJoinCode('KQXT')).toBeNull()
    expect(normalizeJoinCode('KQXTRS')).toBeNull()
  })

  it('rejects letters that are never used in codes, and digits', () => {
    expect(normalizeJoinCode('KQXTO')).toBeNull()
    expect(normalizeJoinCode('KQXT1')).toBeNull()
  })
})
