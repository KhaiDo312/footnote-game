/**
 * /home: start a game, and see the games you host or have joined.
 *
 * The room list is live (useQuery). Permissions decide what arrives: a
 * player only ever receives rooms they host or have joined.
 */

import { Link } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import type { RoomData, RoomStatus } from '@/schemas/game-schemas'

const STATUS_LABEL: Record<RoomStatus, string> = {
  preparing: 'Preparing',
  lobby: 'In lobby',
  question: 'Playing',
  reveal: 'Playing',
  finished: 'Ended',
  failed: 'Not enough content',
  error: 'Needs retry',
}

export default function HomePage() {
  const { isSignedIn } = useAuth()
  const { records } = useQuery<RoomData>('rooms') // newest first by default

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Footnote</h1>
      <p className="mb-8 text-muted-foreground">Trivia from your own document. Rare answers win.</p>

      <Link to="/new">
        <Button data-testid="host-game">Host a new game</Button>
      </Link>

      {isSignedIn && records.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-lg font-semibold">Your games</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {records.map((room) => (
              <li key={room.recordId}>
                <Link to={`/room/${room.recordId}`} className="flex justify-between px-4 py-3 hover:bg-muted">
                  <span>{room.data.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {room.data.status ? STATUS_LABEL[room.data.status] : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
