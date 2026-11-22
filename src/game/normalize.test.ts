import { describe, expect, it } from 'vitest'
import { containsAnswer, normalizeAnswer } from './normalize'

describe('normalizeAnswer', () => {
  it('lowercases, trims, and collapses spaces', () => {
    expect(normalizeAnswer('  Eiffel   TOWER ')).toBe('eiffel tower')
  })

  it('drops punctuation and a leading article', () => {
    expect(normalizeAnswer('The Eiffel Tower!')).toBe('eiffel tower')
    expect(normalizeAnswer('an apple.')).toBe('apple')
  })

  it('keeps an article that is not at the start', () => {
    expect(normalizeAnswer('Tower of the Winds')).toBe('tower of the winds')
  })

  it('keeps accents and non-Latin letters', () => {
    expect(normalizeAnswer('Khải Đỗ')).toBe('khải đỗ')
    expect(normalizeAnswer('Café')).toBe('café')
  })

  it('treats hyphens and slashes as spaces', () => {
    expect(normalizeAnswer('Jean-Paul')).toBe('jean paul')
  })
})

describe('containsAnswer', () => {
  const text = 'She bought ground Cumin, fenugreek and the dried chilies at the market.'

  it('finds an answer as whole words, ignoring case and punctuation', () => {
    expect(containsAnswer(text, 'cumin')).toBe(true)
    expect(containsAnswer(text, 'Dried chilies')).toBe(true)
  })

  it('does not match part of a word', () => {
    expect(containsAnswer('cuminseed', 'cumin')).toBe(false)
  })

  it('does not match "cat" inside "category", after normalizing both sides', () => {
    expect(containsAnswer('Pick a CATEGORY.', 'cat')).toBe(false)
    expect(containsAnswer('Pick a category.', 'The Cat!')).toBe(false)
    // ...but does match the same word on its own, whatever the case and punctuation.
    expect(containsAnswer('Pick a category: CAT, dog.', 'the cat')).toBe(true)
  })

  it('matches when the answer has an article the text lacks', () => {
    expect(containsAnswer(text, 'the market')).toBe(true)
  })

  it('matches at the very start of the text, even after "The"', () => {
    expect(containsAnswer('The Nile floods every year.', 'Nile')).toBe(true)
  })

  it('rejects empty answers', () => {
    expect(containsAnswer(text, '  !! ')).toBe(false)
  })
})
