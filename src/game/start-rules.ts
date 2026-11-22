/**
 * What the host's Start button should do in the lobby, from the room's
 * search-index state. The lobby page uses this to pick the button, and the
 * server's start action (Day 3) uses it to refuse an early start.
 *
 *   'waiting'      index still building → Start is disabled
 *   'ready'        index built          → Start
 *   'retry'        index failed once    → Retry indexing, Start disabled
 *   'start-anyway' failed twice or more → Retry, or "Start anyway"
 *                  (answers not on the list will score 0)
 */

import type { RoomData } from '../schemas/game-schemas'
import { INDEX_FAILURES_BEFORE_START_ANYWAY } from './config'

export type StartState = 'waiting' | 'ready' | 'retry' | 'start-anyway'

export function startState(room: RoomData): StartState {
  // Rooms made before Nov 22 have no indexStatus: they waited for indexing
  // before opening the lobby, so their index is ready.
  const status = room.indexStatus ?? 'ready'
  if (status === 'ready') return 'ready'
  if (status === 'indexing') return 'waiting'
  return (room.indexFailures ?? 0) >= INDEX_FAILURES_BEFORE_START_ANYWAY ? 'start-anyway' : 'retry'
}

/** True when the host may start the game now. */
export function canStart(room: RoomData): boolean {
  const state = startState(room)
  return state === 'ready' || state === 'start-anyway'
}
