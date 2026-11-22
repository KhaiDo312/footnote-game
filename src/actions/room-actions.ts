/**
 * Room server actions: createRoom, retryPrepare, retryIndex, endRoom (PLAN.md §2).
 *
 * Server actions run as the app with permission checks (RBAC) switched off,
 * so every check here (sign-in, host-only, limits) is done by hand.
 * Each one is exposed at POST /api/actions/<name>.
 *
 * Creating a room starts two independent background jobs (src/jobs.ts):
 *   prepare-room  AI writes questions, answers are checked → lobby (seconds)
 *   watch-index   waits for the search index (~2 min), needed only to judge
 *                 answers that are not on the list, so the lobby doesn't wait
 */

import { enqueueJob, KnowledgeError, type ActionHandler, type ActionResult, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { MAX_ACTIVE_ROOMS_PER_HOST, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from '../game/config'
import { makeJoinCode } from '../game/join-code'
import { removeDocuments, uploadDocument } from '../game/knowledge'
import type { RoomData, RoomSecretsData } from '../schemas/game-schemas'

/** Writes questions from the document text and opens the lobby. */
export const PREPARE_ROOM_JOB = 'prepare-room'
/** Waits for the room's search index and records whether it is ready. */
export const WATCH_INDEX_JOB = 'watch-index'
/** Both jobs take the room and an attempt number, so an outdated job can stop. */
export type RoomJobPayload = { roomId: string; attempt: number }

// ---------------------------------------------------------------------------
// createRoom: { title, text } → { roomId, joinCode }
// ---------------------------------------------------------------------------

export const createRoom: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const title = String(params.title ?? '').trim().slice(0, 120) || 'Untitled document'
  const text = typeof params.text === 'string' ? params.text.trim() : ''

  if (text.length < MIN_SOURCE_CHARS) {
    return fail(`The document is too short. Use at least ${MIN_SOURCE_CHARS} characters.`)
  }
  if (text.length > MAX_SOURCE_CHARS) {
    return fail(`The document is too long. The limit is ${MAX_SOURCE_CHARS.toLocaleString('en-US')} characters.`)
  }

  // Cost cap: a host may only have a few rooms that are still in play.
  const mine = await tools.query<RoomData>('rooms', { where: { createdBy: userId } })
  if (!mine.success) return mine
  const active = mine.data.records.filter((r) => r.data.status !== 'finished' && r.data.status !== 'failed')
  if (active.length >= MAX_ACTIVE_ROOMS_PER_HOST) {
    return fail(`You already have ${MAX_ACTIVE_ROOMS_PER_HOST} active games. Finish one before starting another.`)
  }

  // The room row is created "as" the caller, so its createdBy is the host.
  const room = await createRoomWithUniqueCode(tools, title)
  if (!room.success) return room
  const { roomId, joinCode } = room.data

  const secrets = await tools.create<RoomSecretsData>('roomSecrets', {
    roomId,
    sourceText: text,
    knowledgeItemIds: [],
    answerKeys: {},
  })
  if (!secrets.success) return secrets

  // Questions first (the host is waiting on these), then the search index.
  await startJob(env, PREPARE_ROOM_JOB, roomId, 1, userId)
  await startIndexing(env, tools, roomId, secrets.data.recordId, text, { attempt: 1, failures: 0 }, userId)

  return { success: true, data: { roomId, joinCode } }
}

// ---------------------------------------------------------------------------
// retryPrepare: { roomId } → { status }. Only from the 'error' state, which
// now means writing questions failed (e.g. the AI call). The index is
// separate and is not touched.
// ---------------------------------------------------------------------------

export const retryPrepare: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const roomId = String(params.roomId ?? '')
  const room = await tools.get<RoomData>('rooms', roomId)
  if (!room.success) return fail('Room not found.')
  if (room.data.record.createdBy !== userId) return fail('Only the host can retry.')
  if (room.data.record.data.status !== 'error') return fail('This room is not in an error state.')

  const attempt = (room.data.record.data.prepareAttempt ?? 1) + 1
  const marked = await tools.update<RoomData>('rooms', roomId, { status: 'preparing', failReason: '', prepareAttempt: attempt })
  if (!marked.success) return marked
  await startJob(env, PREPARE_ROOM_JOB, roomId, attempt, userId)
  return { success: true, data: { status: 'preparing' } }
}

// ---------------------------------------------------------------------------
// retryIndex: { roomId } → { indexStatus }. Only after indexing failed.
// Removes the old upload and uploads the document again.
// ---------------------------------------------------------------------------

export const retryIndex: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const roomId = String(params.roomId ?? '')
  const room = await tools.get<RoomData>('rooms', roomId)
  if (!room.success) return fail('Room not found.')
  if (room.data.record.createdBy !== userId) return fail('Only the host can retry.')
  const data = room.data.record.data
  if (data.indexStatus !== 'failed') return fail('The answer checker has not failed.')
  if (data.status === 'finished' || data.status === 'failed') return fail('This game is over.')

  const secrets = await getSecrets(tools, roomId)
  if (!secrets) return fail('Room data is missing. Please create a new game.')

  await removeDocuments(env, secrets.data.knowledgeItemIds ?? [])
  const attempt = (data.indexAttempt ?? 1) + 1
  const started = await startIndexing(
    env,
    tools,
    roomId,
    secrets.recordId,
    secrets.data.sourceText ?? '',
    { attempt, failures: data.indexFailures ?? 0 },
    userId,
  )
  if (!started.success) return started
  return { success: true, data: { indexStatus: 'indexing' } }
}

// ---------------------------------------------------------------------------
// endRoom: { roomId } → { status }. Host closes a room at any point.
// A finished room no longer counts toward the host's active-room limit.
// ---------------------------------------------------------------------------

export const endRoom: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const room = await tools.get<RoomData>('rooms', roomId)
  if (!room.success) return fail('Room not found.')
  if (room.data.record.createdBy !== userId) return fail('Only the host can end the game.')
  if (room.data.record.data.status === 'finished') return { success: true, data: { status: 'finished' } }

  const updated = await tools.update<RoomData>('rooms', roomId, { status: 'finished' })
  if (!updated.success) return updated
  return { success: true, data: { status: 'finished' } }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Queues one of the room jobs. `enqueueJob` reaches the job room server-side. */
async function startJob(env: Env, type: string, roomId: string, attempt: number, userId: string) {
  const payload: RoomJobPayload = { roomId, attempt }
  await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, type, payload, { enqueuedBy: userId })
}

/**
 * Uploads the text to the room's knowledge folder and queues watch-index.
 * If the upload itself fails, that counts as a failed indexing attempt: the
 * game can still be prepared, and the host sees Retry in the lobby.
 */
async function startIndexing(
  env: Env,
  tools: ActionTools,
  roomId: string,
  secretsId: string,
  text: string,
  { attempt, failures }: { attempt: number; failures: number },
  userId: string,
): Promise<ActionResult<unknown>> {
  let itemIds: string[]
  try {
    itemIds = await uploadDocument(env, roomId, text)
  } catch (error) {
    console.error('[index] knowledge upload failed', error instanceof KnowledgeError ? error.code : error)
    return tools.update<RoomData>('rooms', roomId, {
      indexStatus: 'failed',
      indexAttempt: attempt,
      indexFailures: failures + 1,
    })
  }

  const saved = await tools.update<RoomSecretsData>('roomSecrets', secretsId, { knowledgeItemIds: itemIds })
  if (!saved.success) return saved
  const marked = await tools.update<RoomData>('rooms', roomId, { indexStatus: 'indexing', indexAttempt: attempt })
  if (!marked.success) return marked

  await startJob(env, WATCH_INDEX_JOB, roomId, attempt, userId)
  return { success: true, data: null }
}

/**
 * Picks a random join code and creates the room with it. The schema's
 * uniqueOn: ['joinCode'] makes the server refuse a duplicate, so on the rare
 * clash we just try another code.
 */
async function createRoomWithUniqueCode(
  tools: ActionTools,
  title: string,
): Promise<ActionResult<{ roomId: string; joinCode: string }>> {
  for (let tries = 0; tries < 5; tries++) {
    const joinCode = makeJoinCode()
    const created = await tools.create<RoomData>('rooms', {
      title,
      joinCode,
      status: 'preparing',
      failReason: '',
      playerIds: [],
      questionCount: 0,
      currentIndex: -1,
      currentQuestionId: '',
      questionEndsAt: 0,
      prepareAttempt: 1,
      indexStatus: 'indexing',
      indexAttempt: 1,
      indexFailures: 0,
    })
    if (created.success) return { success: true, data: { roomId: created.data.recordId, joinCode } }
    if (!created.error.includes('Duplicate')) return created
  }
  return fail('Could not pick a free join code. Please try again.')
}

/** The room's server-only secrets row, or null. Used by actions and the job. */
export async function getSecrets(
  tools: ActionTools,
  roomId: string,
): Promise<{ recordId: string; data: RoomSecretsData } | null> {
  const found = await tools.query<RoomSecretsData>('roomSecrets', { where: { roomId }, limit: 1 })
  if (!found.success || found.data.records.length === 0) return null
  const [row] = found.data.records
  return { recordId: row.recordId, data: row.data }
}

function fail(error: string): ActionResult<never> {
  return { success: false, error }
}
