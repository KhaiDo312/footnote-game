/**
 * Room server actions: createRoom and retryPrepare (PLAN.md §2).
 *
 * Server actions run as the app with permission checks (RBAC) switched off,
 * so every check here (sign-in, host-only, limits) is done by hand.
 * Each one is exposed at POST /api/actions/<name>.
 */

import { enqueueJob, KnowledgeError, type ActionHandler, type ActionResult, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { MAX_ACTIVE_ROOMS_PER_HOST, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from '../game/config'
import { makeJoinCode } from '../game/join-code'
import { removeDocuments, uploadDocument } from '../game/knowledge'
import type { RoomData, RoomSecretsData } from '../schemas/game-schemas'

/** The job type that indexes, generates and verifies questions (src/jobs.ts). */
export const PREPARE_ROOM_JOB = 'prepare-room'
export type PrepareRoomPayload = { roomId: string; attempt: number }

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

  const started = await uploadAndStartPreparing(env, tools, roomId, secrets.data.recordId, text, 1, userId)
  if (!started.success) return started

  return { success: true, data: { roomId, joinCode } }
}

// ---------------------------------------------------------------------------
// retryPrepare: { roomId } → { status }. Only from the 'error' state.
// ---------------------------------------------------------------------------

export const retryPrepare: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const roomId = String(params.roomId ?? '')
  const room = await tools.get<RoomData>('rooms', roomId)
  if (!room.success) return fail('Room not found.')
  if (room.data.record.createdBy !== userId) return fail('Only the host can retry.')
  if (room.data.record.data.status !== 'error') return fail('This room is not in an error state.')

  const secrets = await getSecrets(tools, roomId)
  if (!secrets) return fail('Room data is missing. Please create a new game.')

  // Start from a clean slate: remove the old upload, then upload again.
  // This covers both "indexing failed" and "indexing took too long".
  await removeDocuments(env, secrets.data.knowledgeItemIds ?? [])
  const attempt = (room.data.record.data.prepareAttempt ?? 1) + 1
  const started = await uploadAndStartPreparing(
    env,
    tools,
    roomId,
    secrets.recordId,
    secrets.data.sourceText ?? '',
    attempt,
    userId,
  )
  if (!started.success) return started
  return { success: true, data: { status: 'preparing' } }
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

/**
 * Uploads the text to the room's knowledge folder and queues the prepare-room
 * job. If the upload fails, the room goes to 'error' (with a Retry button)
 * instead of failing the whole request, so the host lands on the room page.
 */
async function uploadAndStartPreparing(
  env: Env,
  tools: ActionTools,
  roomId: string,
  secretsId: string,
  text: string,
  attempt: number,
  userId: string,
): Promise<ActionResult<unknown>> {
  let itemIds: string[]
  try {
    itemIds = await uploadDocument(env, roomId, text)
  } catch (error) {
    console.error('[createRoom] knowledge upload failed', error instanceof KnowledgeError ? error.code : error)
    return tools.update<RoomData>('rooms', roomId, {
      status: 'error',
      failReason: 'Could not upload the document for indexing. Press Retry.',
      prepareAttempt: attempt,
    })
  }

  const saved = await tools.update<RoomSecretsData>('roomSecrets', secretsId, { knowledgeItemIds: itemIds })
  if (!saved.success) return saved
  const marked = await tools.update<RoomData>('rooms', roomId, {
    status: 'preparing',
    failReason: '',
    prepareAttempt: attempt,
  })
  if (!marked.success) return marked

  const payload: PrepareRoomPayload = { roomId, attempt }
  await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, PREPARE_ROOM_JOB, payload, {
    enqueuedBy: userId,
  })
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
