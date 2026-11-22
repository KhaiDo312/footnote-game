/**
 * Who is in the room, and their scores. Scores are set by revealQuestion on
 * the server; this only reads them (live, through useQuery).
 */

import { useQuery } from 'deepspace'
import type { PlayerData } from '@/schemas/game-schemas'

export function PlayerList({ roomId, showScores, empty }: { roomId: string; showScores: boolean; empty: string }) {
  const { records } = useQuery<PlayerData>('players', { where: { roomId } })
  const players = [...records].sort(
    (a, b) => (b.data.score ?? 0) - (a.data.score ?? 0) || (a.data.name ?? '').localeCompare(b.data.name ?? ''),
  )

  if (players.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ol className="divide-y divide-border rounded-lg border border-border" data-testid="player-list">
      {players.map((p) => (
        <li key={p.recordId} className="flex justify-between px-4 py-2">
          <span>{p.data.name}</span>
          {showScores && <span className="font-mono">{p.data.score ?? 0}</span>}
        </li>
      ))}
    </ol>
  )
}

export function FinalScoreboard({ roomId }: { roomId: string }) {
  const { records } = useQuery<PlayerData>('players', { where: { roomId } })
  const [first, second] = [...records].sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0))
  const topScore = first?.data.score ?? 0
  const tied = second !== undefined && (second.data.score ?? 0) === topScore

  return (
    <div data-testid="final-scoreboard">
      <p className="text-lg">This game has ended.</p>
      {topScore > 0 && (
        <p className="mt-2 text-2xl font-semibold">
          {tied ? `It’s a tie at ${topScore} points` : `${first.data.name} wins with ${topScore} points`}
        </p>
      )}
      <h2 className="mt-8 mb-2 text-lg font-semibold">Final scores</h2>
      <PlayerList roomId={roomId} showScores empty="Nobody played." />
    </div>
  )
}
