/**
 * Answer verification (PLAN.md §3): keep only AI answers that really appear
 * in the document, and drop questions left with too few answers.
 *
 * This is a plain text check on the document itself (from roomSecrets), not a
 * search: an answer counts if some paragraph contains it, or one of its
 * aliases, as whole words after normalizing (see containsAnswer). It needs no
 * search index, so the lobby can open without waiting for indexing.
 * The index is still used later, to judge answers that are not on the list.
 */

import { MIN_ANSWERS_PER_QUESTION, QUESTIONS_REQUESTED } from './config'
import { containsAnswer, normalizeAnswer } from './normalize'
import type { GeneratedAnswer, GeneratedQuestion } from './prompts'

/** One verified answer, as stored in roomSecrets.answerKeys. */
export type AnswerKeyEntry = GeneratedAnswer & {
  /** A short excerpt from the document that contains the answer. */
  quote: string
}

export type VerifiedQuestion = {
  prompt: string
  answers: AnswerKeyEntry[]
}

export function verifyQuestions(questions: GeneratedQuestion[], documentText: string): VerifiedQuestion[] {
  const paragraphs = splitParagraphs(documentText)
  const verified: VerifiedQuestion[] = []

  for (const question of questions.slice(0, QUESTIONS_REQUESTED)) {
    const answers = dedupeAnswers(question.answers)
      .map((answer) => verifyAnswer(answer, paragraphs))
      .filter((a): a is AnswerKeyEntry => a !== null)

    if (answers.length >= MIN_ANSWERS_PER_QUESTION) {
      verified.push({ prompt: question.prompt.trim(), answers })
    }
  }
  return verified
}

/** Returns the answer with a supporting quote, or null if the document doesn't contain it. */
function verifyAnswer(answer: GeneratedAnswer, paragraphs: string[]): AnswerKeyEntry | null {
  const spellings = [answer.text, ...answer.aliases]
  for (const paragraph of paragraphs) {
    const found = spellings.find((spelling) => containsAnswer(paragraph, spelling))
    if (found) return { ...answer, quote: quoteAround(paragraph, found) }
  }
  return null
}

/** Paragraphs are separated by blank lines. The quote comes from one paragraph. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
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
