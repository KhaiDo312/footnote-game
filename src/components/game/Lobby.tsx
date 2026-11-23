/**
 * The lobby. The host sees the join code, who has joined, the Start controls
 * and a preview of the questions. Players see who has joined and wait.
 */

import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { startState } from '@/game/start-rules'
import type { QuestionData, RoomData } from '@/schemas/game-schemas'
import { ActionButton } from './ActionButton'
import { PlayerList } from './Scoreboard'

export function HostLobby({ roomId, room }: { roomId: string; room: RoomData }) {
  // The host owns these rows, so they can read them while still hidden.
  const { records } = useQuery<QuestionData>('questions', { where: { roomId }, orderBy: 'index', orderDir: 'asc' })
  const joinCode = room.joinCode ?? ''
  const joinUrl = `${window.location.origin}/join/${joinCode}`

  return (
    <div data-testid="room-lobby">
      <p className="text-sm text-muted-foreground">Join code</p>
      <p data-testid="join-code" className="font-display text-5xl font-semibold tracking-[0.3em] text-primary">
        {joinCode}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Players open <span className="font-mono break-all">{joinUrl}</span>
      </p>

      <h2 className="mt-8 mb-2 text-lg font-semibold">Players</h2>
      <PlayerList roomId={roomId} showScores={false} empty="Nobody has joined yet." />

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

export function PlayerLobby({ roomId }: { roomId: string }) {
  return (
    <div data-testid="player-lobby">
      <p className="pop font-display text-2xl">You’re in.</p>
      <p className="mt-1 text-muted-foreground">Waiting for the host to start…</p>
      <h2 className="mt-8 mb-2 text-lg font-semibold">Players</h2>
      <PlayerList roomId={roomId} showScores={false} empty="" />
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
          <div className="flex items-center gap-3">
            <Button disabled>Start game</Button>
            <span
              role="status"
              aria-label="Getting the answer checker ready"
              className="size-6 rounded-full border-2 border-primary/25 border-t-primary motion-safe:animate-spin"
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Getting the answer checker ready (about 2 minutes). Players can join meanwhile.
          </p>
        </>
      )}
      {state === 'ready' && <ActionButton action="nextQuestion" roomId={roomId} label="Start game" testId="start" />}
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
          label="Start anyway (answers are checked against the text only)"
          testId="start"
        />
      )}
    </div>
  )
}
