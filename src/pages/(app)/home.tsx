/**
 * /home: join a game by code, start a game, and see the games you host or have joined.
 *
 * The room list is live (useQuery). Permissions decide what arrives: a
 * player only ever receives rooms they host or have joined.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { normalizeJoinCode } from '@/game/join-code'
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

      <JoinForm />

      <p className="mt-10 mb-3 text-sm text-muted-foreground">Or run a game from your own document:</p>
      <Link to="/new">
        <Button variant="secondary" data-testid="host-game">
          Host a new game
        </Button>
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

/** Type a code and go to /join/CODE, which does the joining. */
function JoinForm() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const clean = normalizeJoinCode(code)
    if (!clean) return setError('Codes are 5 letters, like KQXTR.')
    navigate(`/join/${clean}`)
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm gap-2">
      <Input
        value={code}
        maxLength={5}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase())
          setError('')
        }}
        placeholder="Join code"
        className="font-mono tracking-widest"
        aria-label="Join code"
      />
      <Button type="submit">Join</Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
