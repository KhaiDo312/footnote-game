/**
 * Results for one question: every answer given, grouped, with points and the
 * line from the document that proves it; the "footnotes" nobody found; your
 * own points; and the running scores. The host sees the Next button.
 */

import { useQuery } from 'deepspace'
import { Badge } from '@/components/ui'
import type { QuestionData, RoomData, SubmissionData } from '@/schemas/game-schemas'
import { ActionButton } from './ActionButton'
import { TIER_LABEL, VERDICT_BADGE, VERDICT_LABEL } from './labels'
import { PlayerList } from './Scoreboard'

export function RevealView({ roomId, room, isHost }: { roomId: string; room: RoomData; isHost: boolean }) {
  const questionId = room.currentQuestionId ?? ''
  const { records } = useQuery<QuestionData>('questions', { where: { recordId: questionId } })
  const question = records[0]?.data
  const results = question?.results
  const isLast = (room.currentIndex ?? 0) + 1 >= (room.questionCount ?? 0)

  return (
    <div data-testid="reveal-view">
      <p className="text-sm text-muted-foreground">
        Question {(room.currentIndex ?? 0) + 1} of {room.questionCount}
      </p>
      <p className="mt-2 text-2xl font-semibold">{question?.prompt}</p>

      {!results ? (
        <p className="mt-6 text-muted-foreground">Checking answers…</p>
      ) : (
        <>
          {!isHost && <MyPoints questionId={questionId} />}

          <ul className="mt-6 space-y-3" data-testid="results">
            {results.groups.length === 0 && <li className="text-muted-foreground">Nobody answered.</li>}
            {results.groups.map((group) => (
              <li key={group.answer} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{group.answer}</span>
                  <Badge variant={VERDICT_BADGE[group.verdict]}>{VERDICT_LABEL[group.verdict]}</Badge>
                  {group.tier !== 'none' && <Badge variant="outline">{TIER_LABEL[group.tier]}</Badge>}
                  <span className="ml-auto font-mono">+{group.points}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {group.playerNames.join(', ')} ({group.count} of {results.totalAnswers})
                </p>
                {group.quote && <blockquote className="mt-2 border-l-2 pl-3 text-sm italic">“{group.quote}”</blockquote>}
              </li>
            ))}
          </ul>

          {results.missed.length > 0 && (
            <>
              <h2 className="mt-8 mb-2 text-lg font-semibold">Footnotes nobody found</h2>
              <p className="text-sm text-muted-foreground">
                {results.missed.map((m) => `${m.text} (${TIER_LABEL[m.tier].toLowerCase()})`).join(' · ')}
              </p>
            </>
          )}
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

function MyPoints({ questionId }: { questionId: string }) {
  const { records } = useQuery<SubmissionData>('submissions', { where: { questionId } })
  const mine = records[0]?.data
  if (!mine) return <p className="mt-6 text-lg">You didn’t answer this one.</p>
  return (
    <p className="mt-6 text-lg" data-testid="my-points">
      You said <strong>{mine.text}</strong>: <strong>+{mine.points ?? 0}</strong>
      {mine.verdict && <span className="text-muted-foreground"> ({VERDICT_LABEL[mine.verdict]})</span>}
    </p>
  )
}
