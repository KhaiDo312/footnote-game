/**
 * Background jobs, run by AppJobRoom (worker.ts). Only server code can start
 * one (see worker.ts and the job test in tests/api.spec.ts). The queue runs
 * one job at a time; a job that is waiting (ctx.continue) steps aside.
 *
 * Creating a room starts both jobs (src/actions/room-actions.ts):
 *
 * 'prepare-room' (seconds), PLAN.md §2–§3:
 *   1. Ask the AI for questions, from the document text in roomSecrets
 *                                               → if it can't: 'error' (Retry)
 *   2. Keep only answers found in the text      → too few questions: 'failed'
 *   3. Save the questions (hidden from players) and the answer keys
 *      (server-only), then open the lobby       → 'lobby'
 *
 * 'watch-index' (~2 minutes), in parallel:
 *   Waits for the room's search index, checking every INDEX_POLL_MS by
 *   "continuing" itself later. Sets room.indexStatus to 'ready', or 'failed'
 *   after an indexing error or INDEX_TIMEOUT_MS. The index is only needed to
 *   judge answers that are not on the list, so the lobby does not wait for it;
 *   the host's Start button does (src/game/start-rules.ts).
 *
 * Records are written with the same RBAC-off tools the server actions use,
 * acting as the host, so the host owns the question rows and can see them
 * before they go live.
 */

import type { ActionTools, Job, JobContext } from 'deepspace/worker'
import { getSecrets, PREPARE_ROOM_JOB, WATCH_INDEX_JOB, type RoomJobPayload } from './actions/room-actions'
import { generateQuestions } from './game/ai'
import { INDEX_POLL_MS, INDEX_TIMEOUT_MS, MIN_PLAYABLE_QUESTIONS } from './game/config'
import { indexingState } from './game/knowledge'
import { verifyQuestions, type AnswerKeyEntry } from './game/verify'
import type { QuestionData, RoomData, RoomSecretsData } from './schemas/game-schemas'
import { createActionTools } from './server/action-routes'
import type { Env } from '../worker'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case PREPARE_ROOM_JOB:
      return prepareRoom(job, env)
    case WATCH_INDEX_JOB:
      return watchIndex(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}

/**
 * Reads the room as the app owner (to learn who the host is), then returns
 * tools that act as the host. Null if the room is gone.
 */
async function loadRoom(env: Env, roomId: string) {
  const ownerTools = createActionTools(env, env.OWNER_USER_ID, '')
  const room = await ownerTools.get<RoomData>('rooms', roomId)
  if (!room.success) return null
  const record = room.data.record
  const tools: ActionTools = createActionTools(env, record.createdBy, '')
  const setRoom = (patch: Partial<RoomData>) => tools.update<RoomData>('rooms', roomId, patch)
  return { data: record.data, createdAt: record.createdAt, tools, setRoom }
}

const seconds = (ms: number) => Math.round(ms / 1000)

// ---------------------------------------------------------------------------
// prepare-room
// ---------------------------------------------------------------------------

async function prepareRoom(job: Job, env: Env): Promise<unknown> {
  const { roomId, attempt } = job.payload as RoomJobPayload
  const room = await loadRoom(env, roomId)
  if (!room) return { skipped: 'room not found' }

  // Stop if this job is out of date: the room moved on, or a Retry started a
  // newer attempt. This also makes the job safe to run twice.
  if (room.data.status !== 'preparing' || room.data.prepareAttempt !== attempt) return { skipped: 'stale job' }
  const { tools, setRoom } = room

  // ---- 1. Generate questions ----------------------------------------------
  const secrets = await getSecrets(tools, roomId)
  if (!secrets?.data.sourceText) {
    await setRoom({ status: 'error', failReason: 'Room data is missing. Please create a new game.' })
    return { outcome: 'error', reason: 'missing secrets' }
  }

  const aiStartedAt = Date.now()
  let generated
  try {
    generated = await generateQuestions(env, secrets.data.sourceText)
  } catch (error) {
    console.error('[prepare-room] AI call failed', error)
    await setRoom({ status: 'error', failReason: 'The AI could not write questions just now. Press Retry.' })
    return { outcome: 'error', reason: 'ai failed' }
  }
  const aiMs = Date.now() - aiStartedAt

  if (!generated.usable) {
    await setRoom({ status: 'failed', failReason: generated.reason || 'This document cannot make a game.' })
    return { outcome: 'failed', reason: 'unusable', aiSeconds: seconds(aiMs) }
  }

  // ---- 2. Verify answers against the document text -------------------------
  const verified = verifyQuestions(generated.questions, secrets.data.sourceText)
  const answersBefore = generated.questions.reduce((n, q) => n + q.answers.length, 0)
  const answersAfter = verified.reduce((n, q) => n + q.answers.length, 0)

  if (verified.length < MIN_PLAYABLE_QUESTIONS) {
    await setRoom({ status: 'failed', failReason: 'Not enough content in this document to make a game.' })
    return { outcome: 'failed', reason: `only ${verified.length} questions verified` }
  }

  // ---- 3. Save questions + answer keys, open the lobby ---------------------
  // Clear questions from any earlier half-finished run first.
  await tools.deleteWhere('questions', { roomId })

  const answerKeys: Record<string, AnswerKeyEntry[]> = {}
  for (const [index, question] of verified.entries()) {
    const created = await tools.create<QuestionData>('questions', {
      roomId,
      index,
      prompt: question.prompt,
      visibility: 'hidden',
      results: null,
    })
    if (!created.success) throw new Error(`Saving question failed: ${created.error}`)
    answerKeys[created.data.recordId] = question.answers
  }

  const saved = await tools.update<RoomSecretsData>('roomSecrets', secrets.recordId, { answerKeys })
  if (!saved.success) throw new Error(`Saving answer keys failed: ${saved.error}`)

  await setRoom({ status: 'lobby', failReason: '', questionCount: verified.length })

  // How long the host waited, from pressing Create to the lobby opening.
  const timing = {
    lobbySeconds: seconds(Date.now() - Date.parse(room.createdAt)),
    aiSeconds: seconds(aiMs),
    questions: `${verified.length}/${generated.questions.length}`,
    answers: `${answersAfter}/${answersBefore}`,
  }
  console.info(`[prepare-room] room=${roomId} lobby ${JSON.stringify(timing)}`)
  return { outcome: 'lobby', ...timing }
}

// ---------------------------------------------------------------------------
// watch-index
// ---------------------------------------------------------------------------

/** Saved between checks while we wait for indexing (passed to ctx.continue). */
type WaitState = { startedAt: number }

async function watchIndex(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const { roomId, attempt } = job.payload as RoomJobPayload
  const room = await loadRoom(env, roomId)
  if (!room) return { skipped: 'room not found' }

  // Out of date: a Retry started a newer attempt, or the game is over.
  const { indexStatus, indexAttempt, indexFailures = 0, status } = room.data
  if (indexStatus !== 'indexing' || indexAttempt !== attempt) return { skipped: 'stale job' }
  if (status === 'finished' || status === 'failed') return { skipped: 'game over' }

  const wait = (job.resumeFrom as WaitState | undefined) ?? { startedAt: Date.now() }
  const state = await indexingState(env, roomId)
  const waitedMs = Date.now() - wait.startedAt

  if (state === 'ready') {
    await room.setRoom({ indexStatus: 'ready' })
    console.info(`[watch-index] room=${roomId} ready after ${seconds(waitedMs)}s`)
    return { outcome: 'ready', seconds: seconds(waitedMs) }
  }

  const timedOut = state === 'waiting' && waitedMs > INDEX_TIMEOUT_MS
  if (state === 'failed' || timedOut) {
    await room.setRoom({ indexStatus: 'failed', indexFailures: indexFailures + 1 })
    const reason = timedOut ? `timed out after ${seconds(waitedMs)}s` : 'indexing error'
    console.warn(`[watch-index] room=${roomId} failed (${reason}), failures=${indexFailures + 1}`)
    return { outcome: 'failed', reason }
  }

  ctx.progress(Math.min(0.99, waitedMs / INDEX_TIMEOUT_MS), 'Indexing')
  ctx.continue(wait, { afterMs: INDEX_POLL_MS }) // run this job again shortly
  return
}
