/**
 * Answer verification (PLAN.md §3): keep only AI answers that really appear
 * in the document, and drop questions left with too few answers.
 *
 * Fulltext search ranks passages; it doesn't say yes or no. So for each
 * answer we search, then check ourselves that a returned passage contains
 * the answer (or one of its aliases) as whole words.
 *
 * `search` is passed in rather than imported, so tests can use a fake one.
 * In the job it is the room's knowledge folder, searched in fulltext mode.
 */

import { MIN_ANSWERS_PER_QUESTION, QUESTIONS_REQUESTED } from './config'
import { containsAnswer, normalizeAnswer } from './normalize'
import type { GeneratedAnswer, GeneratedQuestion } from './prompts'

/** Returns the text of the passages that match `query`. */
export type SearchFn = (query: string) => Promise<string[]>

/** One verified answer, as stored in roomSecrets.answerKeys. */
export type AnswerKeyEntry = GeneratedAnswer & {
  /** A short excerpt from the document that contains the answer. */
  quote: string
}

export type VerifiedQuestion = {
  prompt: string
  answers: AnswerKeyEntry[]
}

export async function verifyQuestions(
  questions: GeneratedQuestion[],
  search: SearchFn,
): Promise<VerifiedQuestion[]> {
  const verified: VerifiedQuestion[] = []

  for (const question of questions.slice(0, QUESTIONS_REQUESTED)) {
    const unique = dedupeAnswers(question.answers)
    // Check this question's answers in parallel; questions one at a time.
    const checked = await Promise.all(unique.map((answer) => verifyAnswer(answer, search)))
    const answers = checked.filter((a): a is AnswerKeyEntry => a !== null)

    if (answers.length >= MIN_ANSWERS_PER_QUESTION) {
      verified.push({ prompt: question.prompt.trim(), answers })
    }
  }
  return verified
}

/** Returns the answer with a supporting quote, or null if the document doesn't contain it. */
async function verifyAnswer(answer: GeneratedAnswer, search: SearchFn): Promise<AnswerKeyEntry | null> {
  const spellings = [answer.text, ...answer.aliases]
  const passages = await search(answer.text)

  for (const passage of passages) {
    const found = spellings.find((spelling) => containsAnswer(passage, spelling))
    if (found) return { ...answer, quote: quoteAround(passage, found) }
  }
  return null
}

/** The AI sometimes lists the same answer twice; keep the first. */
function dedupeAnswers(answers: GeneratedAnswer[]): GeneratedAnswer[] {
  const seen = new Set<string>()
  return answers.filter((answer) => {
    const key = normalizeAnswer(answer.text)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** About 200 characters of `passage` centred on `phrase`, with "…" where cut. */
export function quoteAround(passage: string, phrase: string, width = 200): string {
  const clean = passage.replace(/\s+/g, ' ').trim()
  const at = clean.toLowerCase().indexOf(phrase.toLowerCase())
  if (clean.length <= width) return clean
  // If punctuation differs and the exact phrase isn't found, quote the start.
  const centre = at === -1 ? 0 : at + phrase.length / 2
  const start = Math.max(0, Math.round(centre - width / 2))
  const end = Math.min(clean.length, start + width)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`
}
