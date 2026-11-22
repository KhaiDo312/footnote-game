/**
 * The AI judge (PLAN.md §4.2): at reveal, decides whether answers that are NOT
 * on the answer list are still correct according to the document.
 *
 * For each distinct off-list answer, in parallel:
 *   1. Reuse a saved verdict if there is one (never pay twice).
 *   2. Search the room's document for passages about the question + answer.
 *   3. Ask the AI whether a passage supports the answer, with a quote.
 *   4. Check the quote ourselves (checkQuote). The AI can't invent support.
 * Anything that goes wrong (timeout, error, no passages) gives 'unchecked':
 * 0 points, shown as "Couldn't check", and not saved, so a later reveal can
 * try again.
 *
 * Search, AI and storage are passed in as functions (JudgeDeps), so the tests
 * can use fakes and this file never touches the network itself.
 */

import { JUDGE_MIN_QUOTE_WORDS, JUDGE_TIMEOUT_MS } from './config'
import { containsAnswer } from './normalize'
import { inTag, judgePrompt, type Judgement } from './prompts'
import type { OffListVerdict } from './scoring'

/** A verdict worth saving: the judge actually decided. */
export type FinalVerdict = { verdict: 'supported' | 'rejected'; quote: string }

export type JudgeDeps = {
  /** Passage texts from the room's search index. */
  search: (query: string) => Promise<string[]>
  /** One AI call. Must stop when `signal` aborts. */
  ask: (prompt: string, signal: AbortSignal) => Promise<Judgement>
  /** Saved verdicts for this question, keyed by normalized answer. */
  loadSaved: () => Promise<Record<string, FinalVerdict>>
  /**
   * Saves a verdict and returns the one that is stored. If another reveal
   * saved first, the database keeps theirs (uniqueOn) and this returns it.
   */
  save: (normalized: string, verdict: FinalVerdict) => Promise<FinalVerdict>
}

export type OffListAnswer = { text: string; normalized: string }

/** What happened to one answer, for the log line. */
export type JudgeOutcome = 'saved' | 'judged' | 'unchecked'

export type JudgeReport = {
  verdicts: Record<string, OffListVerdict>
  /** normalized answer → how we got its verdict; `aiSaidYes` before our quote check. */
  log: Record<string, { from: JudgeOutcome; aiSaidYes?: boolean; error?: string }>
}

/**
 * Judges every distinct off-list answer to one question. Never throws:
 * failures become 'unchecked'. `indexReady` false (the host pressed "Start
 * anyway") means no search and no AI call at all.
 */
export async function judgeOffList(
  question: string,
  answers: OffListAnswer[],
  deps: JudgeDeps,
  options: { indexReady: boolean; timeoutMs?: number },
): Promise<JudgeReport> {
  const report: JudgeReport = { verdicts: {}, log: {} }
  // One judgement per distinct answer: "Poisson" and "poisson!" are judged once.
  const distinct = new Map<string, string>()
  for (const a of answers) if (a.normalized && !distinct.has(a.normalized)) distinct.set(a.normalized, a.text)
  if (distinct.size === 0) return report

  if (!options.indexReady) {
    for (const normalized of distinct.keys()) {
      report.verdicts[normalized] = { verdict: 'unchecked', quote: '' }
      report.log[normalized] = { from: 'unchecked', error: 'no search index' }
    }
    return report
  }

  const saved = await deps.loadSaved().catch(() => ({}) as Record<string, FinalVerdict>)

  await Promise.all(
    [...distinct].map(async ([normalized, text]) => {
      if (saved[normalized]) {
        report.verdicts[normalized] = saved[normalized]
        report.log[normalized] = { from: 'saved' }
        return
      }
      try {
        const { verdict, aiSaidYes } = await withTimeout(options.timeoutMs ?? JUDGE_TIMEOUT_MS, (signal) =>
          judgeOne(question, text, deps, signal),
        )
        // If two reveals judged at once, both use whichever verdict was stored first.
        report.verdicts[normalized] = await deps.save(normalized, verdict).catch(() => verdict)
        report.log[normalized] = { from: 'judged', aiSaidYes }
      } catch (error) {
        report.verdicts[normalized] = { verdict: 'unchecked', quote: '' }
        report.log[normalized] = { from: 'unchecked', error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  return report
}

/** Search, ask, check the quote. Throws on any failure (the caller makes it 'unchecked'). */
async function judgeOne(
  question: string,
  answer: string,
  deps: JudgeDeps,
  signal: AbortSignal,
): Promise<{ verdict: FinalVerdict; aiSaidYes: boolean }> {
  const passages = (await deps.search(`${question} ${answer}`)).map(inTag)
  if (passages.length === 0) throw new Error('search found no passages')
  const judgement = await deps.ask(judgePrompt(question, answer, passages), signal)
  const quote = judgement.quote.trim()
  if (judgement.supported && checkQuote(quote, passages, answer)) {
    return { verdict: { verdict: 'supported', quote }, aiSaidYes: true }
  }
  return { verdict: { verdict: 'rejected', quote: '' }, aiSaidYes: judgement.supported }
}

/**
 * Our own check on the AI's "yes". The quote must:
 *   - appear word for word in one of the passages we sent (only runs of
 *     spaces and line breaks may differ; case and punctuation must match),
 *   - be at least JUDGE_MIN_QUOTE_WORDS words long, and
 *   - contain the player's answer as whole words (after normalizing).
 * So the AI can't invent a quote, use a tiny one, or "prove" a synonym.
 */
export function checkQuote(quote: string, passages: string[], answer: string): boolean {
  const q = collapseSpaces(quote)
  if (q.split(' ').filter(Boolean).length < JUDGE_MIN_QUOTE_WORDS) return false
  if (!passages.some((p) => collapseSpaces(p).includes(q))) return false
  return containsAnswer(q, answer)
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Runs `run`, aborting it and throwing 'timed out' after `ms`. */
async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`timed out after ${ms} ms`))
    }, ms)
  })
  try {
    // The search can't be cancelled, so we stop waiting for it; the AI call is cancelled.
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}
