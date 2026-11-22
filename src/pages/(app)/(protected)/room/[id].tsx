/**
 * /room/:id: one page for the whole game; what it shows depends on room.status.
 *
 * So far: the host's side of preparation (preparing → lobby, or error with
 * Retry / failed with the reason) and the lobby's Start controls. Question,
 * reveal and finished views arrive later on Day 3.
 *
 * Everything here updates live: useQuery subscribes over the WebSocket, so
 * when the background job changes the room, this page re-renders on its own.
 */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { startState } from '@/game/start-rules'
import type { QuestionData, RoomData } from '@/schemas/game-schemas'

export default function RoomPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const { records, status } = useQuery<RoomData>('rooms', { where: { recordId: id } })
  const room = records[0]

  if (status === 'loading') return <Shell>Loading…</Shell>
  if (!room) return <Shell>This game doesn&apos;t exist, or you haven&apos;t joined it.</Shell>

  const isHost = room.createdBy === userId
  const data = room.data

  return (
    <Shell title={data.title}>
      {data.status === 'preparing' && (
        <div data-testid="room-preparing">
          <p className="text-lg">Writing questions from your document…</p>
          <p className="mt-2 text-sm text-muted-foreground">This usually takes under a minute.</p>
        </div>
      )}

      {data.status === 'error' && (
        <div data-testid="room-error">
          <p className="text-lg">Something went wrong.</p>
          <p className="mt-2 text-sm text-muted-foreground">{data.failReason}</p>
          {isHost && <ActionButton action="retryPrepare" roomId={room.recordId} label="Retry" />}
        </div>
      )}

      {data.status === 'failed' && (
        <div data-testid="room-failed">
          <p className="text-lg">This document can&apos;t make a game.</p>
          <p className="mt-2 text-sm text-muted-foreground">{data.failReason}</p>
          {isHost && (
            <Link to="/new" className="mt-6 inline-block text-sm underline">
              Try another document
            </Link>
          )}
        </div>
      )}

      {data.status === 'lobby' &&
        (isHost ? <HostLobby roomId={room.recordId} room={data} /> : <p>Waiting for the host to start…</p>)}

      {(data.status === 'question' || data.status === 'reveal') && <p>Game in progress. (Gameplay arrives on Day 3.)</p>}
      {data.status === 'finished' && <p>This game has ended.</p>}

      {isHost && data.status !== 'finished' && (
        <div className="mt-12 border-t border-border pt-6">
          <ActionButton action="endRoom" roomId={room.recordId} label="End game" variant="secondary" />
        </div>
      )}
    </Shell>
  )
}

/** The host's lobby: the join code to share, the Start button, and a preview of the questions. */
function HostLobby({ roomId, room }: { roomId: string; room: RoomData }) {
  // The host owns these rows, so they can read them while still hidden.
  const { records } = useQuery<QuestionData>('questions', { where: { roomId }, orderBy: 'index', orderDir: 'asc' })
  const joinCode = room.joinCode ?? ''
  const joinUrl = `${window.location.origin}/join/${joinCode}`

  return (
    <div data-testid="room-lobby">
      <p className="text-sm text-muted-foreground">Join code</p>
      <p data-testid="join-code" className="font-mono text-5xl font-bold tracking-[0.3em]">
        {joinCode}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Players open <span className="font-mono">{joinUrl}</span>
      </p>

      <StartControls roomId={roomId} room={room} />

      <h2 className="mt-10 mb-3 text-lg font-semibold">Questions ({records.length})</h2>
      <p className="mb-3 text-xs text-muted-foreground">Only you can see these until each one goes live.</p>
      <ol className="list-decimal space-y-2 pl-6" data-testid="host-questions">
        {records.map((q) => (
          <li key={q.recordId}>{q.data.prompt}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The Start button, which waits for the search index (needed to judge answers
 * that are not on the list). See src/game/start-rules.ts for the four states.
 */
function StartControls({ roomId, room }: { roomId: string; room: RoomData }) {
  const state = startState(room)
  return (
    <div className="mt-8" data-testid="start-controls" data-state={state}>
      {state === 'waiting' && (
        <>
          <Button disabled>Start game</Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Getting the answer checker ready (about 2 minutes). Players can join meanwhile.
          </p>
        </>
      )}
      {state === 'ready' && <ActionButton action="nextQuestion" roomId={roomId} label="Start game" />}
      {(state === 'retry' || state === 'start-anyway') && (
        <>
          <p className="text-sm text-destructive">The answer checker failed to get ready.</p>
          <ActionButton action="retryIndex" roomId={roomId} label="Retry" variant="secondary" />
        </>
      )}
      {state === 'start-anyway' && (
        <ActionButton
          action="nextQuestion"
          roomId={roomId}
          label="Start anyway (answers not on the list will score 0)"
        />
      )}
    </div>
  )
}

/** A button that calls a host action for this room and shows any error. */
function ActionButton(props: {
  action: 'retryPrepare' | 'retryIndex' | 'nextQuestion' | 'endRoom'
  roomId: string
  label: string
  variant?: 'secondary'
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    const result = await callAction(props.action, { roomId: props.roomId })
    if (!result.success) setError(result.error)
    setBusy(false) // the room itself updates live via useQuery
  }

  return (
    <div className="mt-6">
      <Button variant={props.variant} disabled={busy} onClick={run}>
        {busy ? 'Working…' : props.label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      {title && <h1 className="mb-8 text-3xl font-bold tracking-tight">{title}</h1>}
      {children}
    </div>
  )
}
