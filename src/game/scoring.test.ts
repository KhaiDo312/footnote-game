import { describe, expect, it } from 'vitest'
import { normalizeAnswer } from './normalize'
import { matchAnswerKey, rarityBonus, scoreQuestion, type SubmissionInput } from './scoring'
import type { AnswerKeyEntry } from './verify'

const key: AnswerKeyEntry[] = [
  { text: 'Normal', aliases: ['normal distribution', 'Gaussian'], tier: 'common', quote: 'the normal distribution' },
  { text: 'Poisson', aliases: [], tier: 'uncommon', quote: 'a Poisson process' },
  { text: 'Hypergeometric', aliases: [], tier: 'niche', quote: 'hypergeometric draws' },
  { text: 'Binomial', aliases: [], tier: 'common', quote: 'binomial trials' },
]

const sub = (userId: string, text: string): SubmissionInput => ({ userId, text, normalized: normalizeAnswer(text) })
const names = { u1: 'Ana', u2: 'Bo', u3: 'Cy', u4: 'Di' }

const pointsByUser = (scored: { userId: string; points: number }[]) =>
  Object.fromEntries(scored.map((s) => [s.userId, s.points]))

describe('scoreQuestion', () => {
  it('scores the agreed worked example: 4 players → 167, 167, 300, 400', () => {
    const { scored, results } = scoreQuestion(
      [sub('u1', 'Normal'), sub('u2', 'normal'), sub('u3', 'Poisson'), sub('u4', 'Hypergeometric')],
      key,
      {},
      names,
    )
    expect(pointsByUser(scored)).toEqual({ u1: 167, u2: 167, u3: 300, u4: 400 })
    expect(results.totalAnswers).toBe(4)
    expect(results.groups.map((g) => [g.answer, g.count, g.points])).toEqual([
      ['Hypergeometric', 1, 400],
      ['Poisson', 1, 300],
      ['Normal', 2, 167],
    ])
    expect(results.groups[2].playerNames).toEqual(['Ana', 'Bo'])
    expect(results.missed).toEqual([{ text: 'Binomial', tier: 'common' }])
  })

  it('counts an alias as the same answer as its entry', () => {
    const { scored, results } = scoreQuestion([sub('u1', 'Normal'), sub('u2', 'Gaussian')], key, {}, names)
    expect(results.groups).toHaveLength(1)
    expect(results.groups[0]).toMatchObject({ answer: 'Normal', count: 2, verdict: 'listed' })
    expect(pointsByUser(scored)).toEqual({ u1: 100, u2: 100 }) // everyone agreed: no bonus
  })

  it('gives no rarity bonus to a single player', () => {
    const { scored } = scoreQuestion([sub('u1', 'Hypergeometric')], key, {}, names)
    expect(scored[0].points).toBe(300)
  })

  it('scores answers not on the list as "unchecked" (0) unless the judge supported them', () => {
    const { scored, results } = scoreQuestion(
      [sub('u1', 'Weibull'), sub('u2', 'Cauchy'), sub('u3', 'Pareto'), sub('u4', 'Normal')],
      key,
      {
        cauchy: { verdict: 'supported', quote: 'a Cauchy tail' },
        pareto: { verdict: 'rejected', quote: '' },
      },
      names,
    )
    const byUser = Object.fromEntries(scored.map((s) => [s.userId, s]))
    expect(byUser.u1).toMatchObject({ verdict: 'unchecked', points: 0, tier: 'none' })
    expect(byUser.u2).toMatchObject({ verdict: 'supported', points: 300 + 100, quote: 'a Cauchy tail' })
    expect(byUser.u3).toMatchObject({ verdict: 'rejected', points: 0 })
    expect(byUser.u4).toMatchObject({ verdict: 'listed', points: 100 + 100 })
    expect(results.groups.find((g) => g.answer === 'Weibull')?.verdict).toBe('unchecked')
  })

  it('groups answers not on the list by normalized text, keeping the first spelling', () => {
    const { results } = scoreQuestion([sub('u1', 'Weibull!'), sub('u2', 'weibull')], key, {}, names)
    expect(results.groups).toEqual([expect.objectContaining({ answer: 'Weibull!', count: 2 })])
  })

  it('handles a question nobody answered', () => {
    const { scored, results } = scoreQuestion([], key, {}, names)
    expect(scored).toEqual([])
    expect(results.missed).toHaveLength(4)
  })
})

describe('matchAnswerKey', () => {
  it('matches whole normalized answers only, not parts of words', () => {
    expect(matchAnswerKey(normalizeAnswer('The Poisson!'), key)).toBe(1)
    expect(matchAnswerKey(normalizeAnswer('Pois'), key)).toBe(-1)
    expect(matchAnswerKey('', key)).toBe(-1)
  })
})

describe('rarityBonus', () => {
  it('is 100 for a unique answer, 0 when everyone agrees', () => {
    expect(rarityBonus(5, 1)).toBe(100)
    expect(rarityBonus(5, 5)).toBe(0)
    expect(rarityBonus(4, 2)).toBe(67)
    expect(rarityBonus(1, 1)).toBe(0)
  })
})
