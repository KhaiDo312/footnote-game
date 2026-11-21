import { describe, expect, it } from 'vitest'
import type { GeneratedQuestion } from './prompts'
import { quoteAround, verifyQuestions, type SearchFn } from './verify'

// A tiny fake "document" split into passages, and a fake fulltext search
// that returns every passage sharing a word with the query.
const passages = [
  'At the market she bought cumin, fenugreek and dried chilies.',
  'Her brother Tomás drove the old Fiat to Lisbon in the rain.',
]
const fakeSearch: SearchFn = async (query) => {
  const words = query.toLowerCase().split(/\s+/)
  return passages.filter((p) => words.some((w) => p.toLowerCase().includes(w)))
}

const question = (prompt: string, answers: [string, string[]?][]): GeneratedQuestion => ({
  prompt,
  answers: answers.map(([text, aliases = []]) => ({ text, aliases, tier: 'common' as const })),
})

describe('verifyQuestions', () => {
  it('keeps answers found in the document and drops invented ones', async () => {
    const result = await verifyQuestions(
      [question('Name a spice she bought.', [['cumin'], ['fenugreek'], ['saffron']])],
      fakeSearch,
    )
    expect(result).toHaveLength(1)
    expect(result[0].answers.map((a) => a.text)).toEqual(['cumin', 'fenugreek'])
    expect(result[0].answers[0].quote).toContain('cumin')
  })

  it('accepts an answer when only an alias appears in the passage', async () => {
    const result = await verifyQuestions(
      [question('Name a vehicle or place.', [['Fiat car', ['Fiat']], ['Lisbon']])],
      fakeSearch,
    )
    expect(result[0].answers.map((a) => a.text)).toEqual(['Fiat car', 'Lisbon'])
  })

  it('drops a question left with fewer than 2 verified answers', async () => {
    const result = await verifyQuestions(
      [question('Name a spice.', [['cumin'], ['saffron'], ['nutmeg']])],
      fakeSearch,
    )
    expect(result).toEqual([])
  })

  it('removes duplicate answers', async () => {
    const result = await verifyQuestions(
      [question('Name a spice.', [['Cumin'], ['cumin!'], ['fenugreek']])],
      fakeSearch,
    )
    expect(result[0].answers).toHaveLength(2)
  })
})

describe('quoteAround', () => {
  it('returns short passages whole', () => {
    expect(quoteAround('A short line about cumin.', 'cumin')).toBe('A short line about cumin.')
  })

  it('cuts long passages around the phrase with ellipses', () => {
    const long = `${'x '.repeat(200)}the cumin seeds ${'y '.repeat(200)}`
    const quote = quoteAround(long, 'cumin', 60)
    expect(quote).toContain('cumin')
    expect(quote.startsWith('…')).toBe(true)
    expect(quote.endsWith('…')).toBe(true)
  })
})
