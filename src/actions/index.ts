/**
 * Server actions, each exposed at POST /api/actions/<name>.
 * Call them from the browser with callAction() in src/lib/call-action.ts.
 */

import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createRoom, endRoom, retryIndex, retryPrepare } from './room-actions'

export const actions: Record<string, ActionHandler<Env>> = {
  createRoom,
  retryPrepare,
  retryIndex,
  endRoom,
}
