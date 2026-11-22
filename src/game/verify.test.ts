import { describe, expect, it } from 'vitest'
import type { GeneratedQuestion } from './prompts'
import { quoteAround, verifyQuestions } from './verify'

// A tiny "document" with two paragraphs.
const doc = [
  'At the market she bought cumin, fenugreek and dried chilies.',
  '',
  'Her brother Tomás drove the old Fiat to Lisbon in the rain.',
].join('\n')

const question = (prompt: string, answers: [string, string[]?][]): GeneratedQuestion => ({
  prompt,
  answers: answers.map(([text, aliases = []]) => ({ text, aliases, tier: 'common' as const })),
})

describe('verifyQuestions', () => {
  it('keeps answers found in the document and drops invented ones', () => {
    const result = verifyQuestions([question('Name a spice she bought.', [['cumin'], ['fenugreek'], ['saffron']])], doc)
    expect(result).toHaveLength(1)
    expect(result[0].answers.map((a) => a.text)).toEqual(['cumin', 'fenugreek'])
    expect(result[0].answers[0].quote).toBe('At the market she bought cumin, fenugreek and dried chilies.')
  })

  it('quotes the paragraph the answer is in', () => {
    const result = verifyQuestions([question('Name a place or person.', [['Lisbon'], ['Tomás']])], doc)
    expect(result[0].answers[0].quote).toContain('Fiat to Lisbon')
  })

  it('accepts an answer when only an alias appears', () => {
    const result = verifyQuestions([question('Name a vehicle or place.', [['Fiat car', ['Fiat']], ['Lisbon']])], doc)
    expect(result[0].answers.map((a) => a.text)).toEqual(['Fiat car', 'Lisbon'])
  })

  it('rejects an answer that only appears inside a longer word', () => {
    const result = verifyQuestions([question('Name a thing.', [['chili'], ['cumin'], ['market']])], doc)
    expect(result[0].answers.map((a) => a.text)).toEqual(['cumin', 'market'])
  })

  it('drops a question left with fewer than 2 verified answers', () => {
    expect(verifyQuestions([question('Name a spice.', [['cumin'], ['saffron'], ['nutmeg']])], doc)).toEqual([])
  })

  it('removes duplicate answers', () => {
    const result = verifyQuestions([question('Name a spice.', [['Cumin'], ['cumin!'], ['fenugreek']])], doc)
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
