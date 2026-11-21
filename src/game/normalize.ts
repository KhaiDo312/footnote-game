/**
 * Answer normalization: turns what someone typed into a canonical form, so
 * "The Eiffel Tower!" and "eiffel  tower" count as the same answer.
 *
 * Used to (1) check AI answers against document text, (2) match a player's
 * answer to the answer list, and (3) group identical player answers for the
 * rarity bonus. Pure functions: no network, easy to test.
 */

/** Lowercase, no punctuation, single spaces. Used for whole passages of text. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC') // unify look-alike Unicode forms (e.g. full-width letters)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ') // punctuation and symbols become spaces
    .replace(/\s+/g, ' ') // collapse runs of whitespace
    .trim()
}

/** Like normalizeText, plus drops a leading "the", "a" or "an". Used for short answers. */
export function normalizeAnswer(input: string): string {
  return normalizeText(input).replace(/^(the|a|an) /, '')
}

/**
 * True when `answer` appears in `text` as whole words, after normalizing
 * both. "cumin" is found in "ground cumin seeds" but not in "cuminseed".
 */
export function containsAnswer(text: string, answer: string): boolean {
  const needle = normalizeAnswer(answer)
  if (!needle) return false
  // Spaces on both sides make sure we only match whole words.
  return ` ${normalizeText(text)} `.includes(` ${needle} `)
}
