/**
 * /room/:id: one page for the whole game; what it shows depends on room.status
 * (PLAN.md §6) and on whether you are the host. The views themselves are in
 * src/components/game/.
 *
 * Everything here updates live: useQuery subscribes over the WebSocket, so
 * when an action or the background job changes the room, this page
 * re-renders on its own.
 */

import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { ActionButton } from '@/components/game/ActionButton'
import { HostLobby, PlayerLobby } from '@/components/game/Lobby'
import { QuestionView } from '@/components/game/QuestionView'
import { RevealView } from '@/components/game/RevealView'
import { FinalScoreboard } from '@/components/game/Scoreboard'
import type { RoomData } from '@/schemas/game-schemas'

export default function RoomPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  // Permissions decide what arrives: only the host and joined players get the room.
  const { records, status } = useQuery<RoomData>('rooms', { where: { recordId: id } })
  const room = records[0]

  if (status === 'loading') return <Shell>Loading…</Shell>
  if (!room) return <Shell>This game doesn&apos;t exist, or you haven&apos;t joined it.</Shell>

  const isHost = room.createdBy === userId
  const roomId = room.recordId
  const data = room.data

  return (
    <Shell title={data.title}>
      {data.status === 'preparing' && (
        <div data-testid="room-preparing">
          <p className="text-lg">Writing questions from the document…</p>
          <p className="mt-2 text-sm text-muted-foreground">This usually takes under a minute.</p>
        </div>
      )}

      {data.status === 'error' && (
        <div data-testid="room-error">
          <p className="text-lg">Something went wrong.</p>
          <p className="mt-2 text-sm text-muted-foreground">{data.failReason}</p>
          {isHost && <ActionButton action="retryPrepare" roomId={roomId} label="Retry" />}
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

      {data.status === 'lobby' && (isHost ? <HostLobby roomId={roomId} room={data} /> : <PlayerLobby roomId={roomId} />)}
      {data.status === 'question' && <QuestionView roomId={roomId} room={data} isHost={isHost} />}
      {data.status === 'reveal' && <RevealView roomId={roomId} room={data} isHost={isHost} />}
      {data.status === 'finished' && <FinalScoreboard roomId={roomId} />}

      {isHost && data.status !== 'finished' && (
        <div className="mt-12 border-t border-border pt-6">
          <ActionButton action="endRoom" roomId={roomId} label="End game" variant="secondary" />
        </div>
      )}
    </Shell>
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
