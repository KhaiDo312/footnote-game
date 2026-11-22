/**
 * Scoring one question (PLAN.md §5). Pure: no network, no database.
 *
 *   base         common 100 · uncommon 200 · niche 300 · supported 300
 *                rejected / unchecked 0
 *   P            players who answered this question
 *   n            players who gave the same answer
 *   rarityBonus  P ≤ 1 ? 0 : round(100 × (P − n) / (P − 1))
 *   points       base is 0 ? 0 : base + rarityBonus
 *
 * "The same answer" means the same answer-list entry (so an alias counts
 * as its entry), or, for answers not on the list, the same normalized text.
 */

import type { AnswerTier, Verdict } from '../schemas/game-schemas'
import { RARITY_BONUS_MAX, SUPPORTED_POINTS, TIER_POINTS } from './config'
import { normalizeAnswer } from './normalize'
import type { AnswerKeyEntry } from './verify'

export type SubmissionInput = { userId: string; text: string; normalized: string }

/** What the AI judge decided for one answer not on the list (Day 4). */
export type OffListVerdict = { verdict: 'supported' | 'rejected' | 'unchecked'; quote: string }

export type ScoredSubmission = {
  userId: string
  verdict: Verdict
  tier: AnswerTier
  points: number
  quote: string
}

/** Stored in questions.results at reveal, readable by everyone in the room. */
export type QuestionResults = {
  totalAnswers: number
  groups: {
    answer: string
    tier: AnswerTier
    verdict: Verdict
    count: number
    points: number
    quote: string
    playerNames: string[]
  }[]
  /** Listed answers nobody gave: the "footnotes". */
  missed: { text: string; tier: AnswerTier }[]
}

/** Index of the answer-list entry this normalized answer matches, or -1. */
export function matchAnswerKey(normalized: string, answerKey: AnswerKeyEntry[]): number {
  if (!normalized) return -1
  return answerKey.findIndex((entry) =>
    [entry.text, ...entry.aliases].some((spelling) => normalizeAnswer(spelling) === normalized),
  )
}

export function rarityBonus(totalPlayers: number, sameAnswer: number): number {
  if (totalPlayers <= 1) return 0
  return Math.round((RARITY_BONUS_MAX * (totalPlayers - sameAnswer)) / (totalPlayers - 1))
}

/**
 * Scores every submission to one question.
 * `offList` maps a normalized answer to the judge's verdict; anything missing
 * from it is 'unchecked'. `names` maps userId → display name.
 */
export function scoreQuestion(
  submissions: SubmissionInput[],
  answerKey: AnswerKeyEntry[],
  offList: Record<string, OffListVerdict>,
  names: Record<string, string>,
): { scored: ScoredSubmission[]; results: QuestionResults } {
  // 1. Put each submission into a group: a listed entry, or its own text.
  type Group = { answer: string; tier: AnswerTier; verdict: Verdict; quote: string; base: number; userIds: string[] }
  const groups = new Map<string, Group>()
  const groupOf = new Map<string, string>() // userId → group key

  for (const sub of submissions) {
    const keyIndex = matchAnswerKey(sub.normalized, answerKey)
    const groupKey = keyIndex >= 0 ? `list:${keyIndex}` : `text:${sub.normalized}`
    let group = groups.get(groupKey)
    if (!group) {
      group = keyIndex >= 0 ? listedGroup(answerKey[keyIndex]) : offListGroup(sub.text, offList[sub.normalized])
      groups.set(groupKey, group)
    }
    group.userIds.push(sub.userId)
    groupOf.set(sub.userId, groupKey)
  }

  // 2. Points per group: base + rarity bonus (nothing for 0-base answers).
  const P = submissions.length
  const pointsOf = (g: Group) => (g.base === 0 ? 0 : g.base + rarityBonus(P, g.userIds.length))

  const scored = submissions.map((sub): ScoredSubmission => {
    const g = groups.get(groupOf.get(sub.userId)!)!
    return { userId: sub.userId, verdict: g.verdict, tier: g.tier, points: pointsOf(g), quote: g.quote }
  })

  const resultGroups = [...groups.values()]
    .map((g) => ({
      answer: g.answer,
      tier: g.tier,
      verdict: g.verdict,
      count: g.userIds.length,
      points: pointsOf(g),
      quote: g.quote,
      playerNames: g.userIds.map((id) => names[id] ?? 'Player'),
    }))
    .sort((a, b) => b.points - a.points || b.count - a.count)

  const missed = answerKey
    .filter((_, i) => !groups.has(`list:${i}`))
    .map((entry) => ({ text: entry.text, tier: entry.tier }))

  return { scored, results: { totalAnswers: P, groups: resultGroups, missed } }
}

function listedGroup(entry: AnswerKeyEntry) {
  return {
    answer: entry.text,
    tier: entry.tier,
    verdict: 'listed' as Verdict,
    quote: entry.quote,
    base: TIER_POINTS[entry.tier],
    userIds: [] as string[],
  }
}

function offListGroup(text: string, judged: OffListVerdict | undefined) {
  const verdict = judged?.verdict ?? 'unchecked'
  return {
    answer: text.trim(),
    tier: 'none' as AnswerTier,
    verdict: verdict as Verdict,
    quote: judged?.quote ?? '',
    base: verdict === 'supported' ? SUPPORTED_POINTS : 0,
    userIds: [] as string[],
  }
}
