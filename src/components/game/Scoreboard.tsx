/**
 * Who is in the room, and their scores. Scores are set by revealQuestion on
 * the server; this only reads them (live, through useQuery).
 */

import type { CSSProperties } from "react";
import { useAuth, useQuery } from "deepspace";
import type { PlayerData } from "@/schemas/game-schemas";

type Player = { recordId: string; data: PlayerData };

const byScore = (a: Player, b: Player) =>
  (b.data.score ?? 0) - (a.data.score ?? 0) ||
  (a.data.name ?? "").localeCompare(b.data.name ?? "");

export function PlayerList(props: {
  roomId: string;
  showScores: boolean;
  empty: string;
  className?: string;
}) {
  const { records } = useQuery<PlayerData>("players", {
    where: { roomId: props.roomId },
  });
  const players = [...records].sort(byScore);

  if (players.length === 0)
    return <p className="text-sm text-muted-foreground">{props.empty}</p>;
  return (
    <ol
      className={`divide-y divide-border rounded border border-border ${props.className ?? ""}`}
      data-testid="player-list"
    >
      {players.map((p, i) => (
        <li
          key={p.recordId}
          className="ink-in flex h-10 items-center gap-3 px-4"
        >
          {props.showScores && (
            <span className="w-5 font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
          )}
          <span className="flex-1 truncate font-display">{p.data.name}</span>
          {props.showScores && (
            <span className="font-mono">{p.data.score ?? 0}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function FinalScoreboard({ roomId }: { roomId: string }) {
  const { userId } = useAuth();
  const { records } = useQuery<PlayerData>("players", { where: { roomId } });
  const [first, second] = [...records].sort(byScore);
  const topScore = first?.data.score ?? 0;
  const tied = second !== undefined && (second.data.score ?? 0) === topScore;

  return (
    <div data-testid="final-scoreboard">
      <p className="text-lg">This game has ended.</p>
      {topScore > 0 && (
        <p className="pop mt-2 font-display text-3xl font-semibold">
          {tied
            ? `It’s a tie at ${topScore} points`
            : `${first.data.name} wins with ${topScore} points`}
        </p>
      )}
      <h2 className="mt-8 mb-2 text-lg font-semibold">Final scores</h2>
      {/* Three rows show (h-10 each, plus borders); scroll for the rest. */}
      <PlayerList
        roomId={roomId}
        showScores
        empty="Nobody played."
        className="max-h-[7.75rem] overflow-y-auto"
      />
      {records.length > 0 && <DepthNote players={records} me={userId} />}
    </div>
  );
}

/**
 * A paper note with one ink line per player, hanging from the top: the higher
 * the score, the deeper the line (an upside-down bar chart). Your line is red.
 * The note keeps the same size however many players there are.
 */
function DepthNote({
  players,
  me,
}: {
  players: Player[];
  me: string | null | undefined;
}) {
  const max = Math.max(1, ...players.map((p) => p.data.score ?? 0));

  return (
    <figure className="note mt-10 px-5 pt-4 pb-10" data-testid="depth-note">
      <figcaption className="font-display text-sm italic">
        How deep everyone read
      </figcaption>
      <div className="mt-3 flex h-52" aria-hidden>
        {players.map((p, i) => {
          const score = p.data.score ?? 0;
          const depth = Math.max(2, (score / max) * 85); // % of the height; room left for "You"
          const mine = p.data.userId === me;
          return (
            <div
              key={p.recordId}
              className="relative flex min-w-0 flex-1 justify-center"
              title={`${p.data.name}: ${score}`}
            >
              <div
                className={`ink-flow w-[3px] rounded-b-full ${mine ? "bg-primary" : "bg-foreground"}`}
                style={{ height: `${depth}%`, "--i": i } as CSSProperties}
              />
              {mine && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 rounded border border-primary bg-[#fffaf0] px-1.5 text-xs text-primary"
                  style={{ top: `calc(${depth}% + 6px)` }}
                >
                  You
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul className="sr-only">
        {[...players].sort(byScore).map((p) => (
          <li key={p.recordId}>
            {p.data.name}: {p.data.score ?? 0} points
            {p.data.userId === me ? " (you)" : ""}
          </li>
        ))}
      </ul>
    </figure>
  );
}
