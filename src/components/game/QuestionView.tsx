/**
 * A live question. Everyone sees the prompt and the countdown. Players type
 * one answer (it locks once sent); the host sees the Reveal button.
 */

import { useState, type FormEvent } from 'react'
import { useQuery } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { MAX_ANSWER_CHARS } from '@/game/config'
import { callAction } from '@/lib/call-action'
import { useSecondsLeft } from '@/lib/use-seconds-left'
import type { QuestionData, RoomData, SubmissionData } from '@/schemas/game-schemas'
import { ActionButton } from './ActionButton'

export function QuestionView({ roomId, room, isHost }: { roomId: string; room: RoomData; isHost: boolean }) {
  const questionId = room.currentQuestionId ?? ''
  // Players can read a question once nextQuestion marks it 'shown'.
  const { records } = useQuery<QuestionData>('questions', { where: { recordId: questionId } })
  const question = records[0]
  const secondsLeft = useSecondsLeft(room.questionEndsAt)

  return (
    <div data-testid="question-view">
      <div className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>
          Question {(room.currentIndex ?? 0) + 1} of {room.questionCount}
        </span>
        <span data-testid="seconds-left" className={`font-mono text-2xl ${secondsLeft <= 5 ? 'text-destructive' : ''}`}>
          {secondsLeft}s
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold">{question?.data.prompt ?? '…'}</p>

      {isHost ? (
        <ActionButton
          action="revealQuestion"
          roomId={roomId}
          label={secondsLeft > 0 ? 'Reveal now' : 'Reveal answers'}
          testId="reveal"
        />
      ) : (
        <AnswerBox roomId={roomId} questionId={questionId} timeUp={secondsLeft === 0} />
      )}
    </div>
  )
}

function AnswerBox({ roomId, questionId, timeUp }: { roomId: string; questionId: string; timeUp: boolean }) {
  // 'own' read permission: this only ever returns my own submission.
  const { records } = useQuery<SubmissionData>('submissions', { where: { questionId } })
  const mine = records[0]
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await callAction('submitAnswer', { roomId, questionId, text })
    if (!result.success) setError(result.error)
    setBusy(false) // on success, `mine` arrives live and replaces the form
  }

  if (mine) {
    return (
      <p className="mt-8 text-lg" data-testid="answer-locked">
        Locked in: <strong>{mine.data.text}</strong>
      </p>
    )
  }
  if (timeUp) return <p className="mt-8 text-lg text-muted-foreground">Time’s up.</p>

  return (
    <form onSubmit={onSubmit} className="mt-8 flex gap-2">
      <Input
        autoFocus
        value={text}
        maxLength={MAX_ANSWER_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your answer (rarer scores more)"
        data-testid="answer-input"
      />
      <Button type="submit" disabled={busy || !text.trim()}>
        {busy ? 'Sending…' : 'Lock in'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
