/**
 * Join codes: short room codes like "KQXTR" that players type or open as /join/KQXTR.
 *
 * Pure functions (no network, no database) so they are easy to test.
 * Uniqueness is NOT decided here: createRoom checks for a clash, and the
 * `rooms` schema's `uniqueOn: ['joinCode']` makes the server refuse duplicates.
 */

import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from './config'

/** Returns a whole number from 0 up to (but not including) `max`. */
type RandomInt = (max: number) => number

/** Default randomness: the browser/Worker crypto API, not Math.random. */
const cryptoRandomInt: RandomInt = (max) => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] % max
}

/** Makes a new random code. Pass `randomInt` only in tests. */
export function makeJoinCode(randomInt: RandomInt = cryptoRandomInt): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]
  }
  return code
}

/**
 * Cleans up what a player typed: trims spaces, uppercases.
 * Returns null when it can't be a valid code (wrong length or a letter we never use).
 */
export function normalizeJoinCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  if (code.length !== JOIN_CODE_LENGTH) return null
  for (const letter of code) {
    if (!JOIN_CODE_ALPHABET.includes(letter)) return null
  }
  return code
}
