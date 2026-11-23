/**
 * Results for one question, laid out as a page: the rarer an answer, the
 * lower it sinks.
 *   body text      common answers on the list
 *   margin note    uncommon answers
 *   footnote ¹     niche answers
 *   deep footnote † answers not on the list that the AI judge found
 * Answers that didn't count are struck out at the top. Each answer drops onto
 * the page in turn (rarer ones fall further) and its points count up.
 * Also: the "footnotes" nobody found, your own points, the running scores,
 * and the host's Next button.
 */

import type { CSSProperties } from 'react'
import { useQuery } from 'deepspace'
import type { QuestionResults } from '@/game/scoring'
import { useCountUp } from '@/lib/use-count-up'
import type { QuestionData, RoomData, SubmissionData } from '@/schemas/game-schemas'
import { ActionButton } from './ActionButton'
import { TIER_LABEL, VERDICT_LABEL } from './labels'
import { PlayerList } from './Scoreboard'

type Group = QuestionResults['groups'][number]
type Depth = 'struck' | 'body' | 'margin' | 'footnote' | 'deep'

const DEPTHS: Depth[] = ['struck', 'body', 'margin', 'footnote', 'deep']
const FALL: Record<Depth, string> = { struck: '8px', body: '14px', margin: '24px', footnote: '40px', deep: '64px' }
const DEPTH_LABEL: Record<Depth, string> = {
  struck: 'Not counted',
  body: 'Body text',
  margin: 'Margin note',
  footnote: 'Footnote',
  deep: 'Deep footnote',
}
const STEP_MS = 380 // must match the animation-delay step of .ink-drop in styles.css
const FOOTNOTE_MARKS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const DEEP_MARKS = ['†', '‡', '§', '‖', '¶']

function depthOf(group: Group): Depth {
  if (group.verdict === 'supported') return 'deep'
  if (group.verdict !== 'listed') return 'struck'
  if (group.tier === 'niche') return 'footnote'
  return group.tier === 'uncommon' ? 'margin' : 'body'
}

export function RevealView({ roomId, room, isHost }: { roomId: string; room: RoomData; isHost: boolean }) {
  const questionId = room.currentQuestionId ?? ''
  const { records } = useQuery<QuestionData>('questions', { where: { recordId: questionId } })
  const question = records[0]?.data
  const results = question?.results
  const isLast = (room.currentIndex ?? 0) + 1 >= (room.questionCount ?? 0)

  // Group by depth, top of the page first; each answer gets its drop order and mark.
  const bands = DEPTHS.map((depth) => ({ depth, groups: (results?.groups ?? []).filter((g) => depthOf(g) === depth) }))
  const order = bands.flatMap((b) => b.groups)
  const mark = (depth: Depth, i: number) =>
    depth === 'footnote' ? FOOTNOTE_MARKS[i % 9] : depth === 'deep' ? DEEP_MARKS[i % 5] : ''
  const marks = bands.flatMap((b) => b.groups.map((_, i) => mark(b.depth, i))).filter(Boolean)

  return (
    <div data-testid="reveal-view">
      <p className="text-sm text-muted-foreground">
        Question {(room.currentIndex ?? 0) + 1} of {room.questionCount}
      </p>
      <h2 className="mt-2 text-2xl leading-snug font-semibold">
        {question?.prompt}
        {marks.length > 0 && <sup className="ml-1 text-base font-normal text-primary">{marks.join('')}</sup>}
      </h2>

      {!results ? (
        <p className="mt-6 text-muted-foreground">Checking answers…</p>
      ) : (
        <>
          {results.groups.length === 0 && <p className="mt-6 text-muted-foreground">Nobody answered.</p>}

          <div className="mt-6" data-testid="results">
            {bands.map(
              ({ depth, groups }) =>
                groups.length > 0 && (
                  <section key={depth} className={bandClass(depth)} aria-label={DEPTH_LABEL[depth]}>
                    {(depth === 'footnote' || depth === 'deep') && (
                      <hr className="mb-3 w-1/3 border-foreground/40" aria-hidden />
                    )}
                    <p className="mb-1 text-[0.65rem] tracking-[0.18em] text-muted-foreground uppercase">
                      {DEPTH_LABEL[depth]}
                    </p>
                    <ul className="space-y-3">
                      {groups.map((group, i) => (
                        <Answer
                          key={group.answer}
                          group={group}
                          depth={depth}
                          mark={mark(depth, i)}
                          index={order.indexOf(group)}
                          total={results.totalAnswers}
                        />
                      ))}
                    </ul>
                  </section>
                ),
            )}
          </div>

          {results.missed.length > 0 && (
            <p className="mt-8 border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
              <span className="font-display italic">Footnotes nobody found: </span>
              {results.missed.map((m) => `${m.text} (${TIER_LABEL[m.tier].toLowerCase()})`).join(' · ')}
            </p>
          )}

          {!isHost && <MyPoints questionId={questionId} delayMs={order.length * STEP_MS} />}
        </>
      )}

      <h2 className="mt-10 mb-2 text-lg font-semibold">Scores</h2>
      <PlayerList roomId={roomId} showScores empty="No players." />

      {isHost && results && (
        <ActionButton
          action="nextQuestion"
          roomId={roomId}
          label={isLast ? 'Show final scores' : 'Next question'}
          testId="next"
        />
      )}
    </div>
  )
}

function bandClass(depth: Depth): string {
  switch (depth) {
    case 'struck':
    case 'body':
      return 'mb-5'
    case 'margin':
      return 'mb-6 ml-4 border-l-2 border-primary/50 pl-3 italic sm:ml-10'
    case 'footnote':
      return 'mt-8 text-sm'
    case 'deep':
      return 'mt-10 text-xs'
  }
}

function Answer(props: { group: Group; depth: Depth; mark: string; index: number; total: number }) {
  const { group, depth, mark, index, total } = props
  const points = useCountUp(group.points, index * STEP_MS + 300)
  const struck = depth === 'struck'
  const big = depth === 'body' ? 'text-xl' : depth === 'margin' ? 'text-lg' : ''

  return (
    <li className="ink-drop" style={{ '--i': index, '--fall': FALL[depth] } as CSSProperties}>
      <div className="flex items-baseline gap-2">
        {mark && <span className="font-display text-primary">{mark}</span>}
        <span
          className={`font-display ${big} ${struck && group.verdict === 'rejected' ? 'line-through decoration-primary/70' : ''} ${struck ? 'text-muted-foreground' : ''}`}
        >
          {group.answer}
        </span>
        {/* dotted leader, like a table of contents */}
        <span className="min-w-4 flex-1 border-b border-dotted border-foreground/30" aria-hidden />
        <span className={`font-mono ${points > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
          <span aria-hidden>+{points}</span>
          <span className="sr-only">{group.points} points</span>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground not-italic">
        {group.playerNames.join(', ')} ({group.count} of {total}) · {VERDICT_LABEL[group.verdict]}
      </p>
      {group.quote && (
        <blockquote className="mt-1 font-display text-sm text-foreground/80 italic">“{group.quote}”</blockquote>
      )}
    </li>
  )
}

function MyPoints({ questionId, delayMs }: { questionId: string; delayMs: number }) {
  const { records } = useQuery<SubmissionData>('submissions', { where: { questionId } })
  const mine = records[0]?.data
  const points = useCountUp(mine?.points ?? 0, delayMs)
  if (!mine) return <p className="mt-8 text-lg">You didn’t answer this one.</p>
  return (
    <p className="mt-8 rounded border border-border bg-muted/60 px-4 py-3 text-lg" data-testid="my-points">
      You said <strong className="font-display">{mine.text}</strong>:{' '}
      <strong className="font-mono text-primary">
        <span aria-hidden>+{points}</span>
        <span className="sr-only">{mine.points ?? 0} points</span>
      </strong>
      {mine.verdict && <span className="text-sm text-muted-foreground"> ({VERDICT_LABEL[mine.verdict]})</span>}
    </p>
  )
}
