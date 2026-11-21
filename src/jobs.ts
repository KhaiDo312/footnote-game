/**
 * Background jobs, run by AppJobRoom (worker.ts). Only server code can start
 * one (see worker.ts and tests/job-permissions.spec.ts).
 *
 * 'prepare-room' turns an uploaded document into a playable room
 * (PLAN.md §2, §3, §6):
 *
 *   1. Wait for the knowledge index to finish. The job checks every
 *      INDEX_POLL_MS by "continuing" itself later (ctx.continue), and gives up
 *      after INDEX_TIMEOUT_MS → room 'error' (the host gets a Retry button).
 *   2. Ask the AI for questions                → if it can't: 'error'
 *   3. Keep only answers found in the document → too few questions: 'failed'
 *   4. Save the questions (hidden from players) and the answer keys
 *      (server-only), then open the lobby      → 'lobby'
 *
 * Records are written with the same RBAC-off tools the server actions use,
 * acting as the host, so the host owns the question rows and can see them
 * before they go live.
 */

import type { Job, JobContext } from 'deepspace/worker'
import { getSecrets, PREPARE_ROOM_JOB, type PrepareRoomPayload } from './actions/room-actions'
import { generateQuestions } from './game/ai'
import { INDEX_POLL_MS, INDEX_TIMEOUT_MS, MIN_PLAYABLE_QUESTIONS } from './game/config'
import { indexingState, searchRoom } from './game/knowledge'
import { verifyQuestions, type AnswerKeyEntry } from './game/verify'
import type { QuestionData, RoomData, RoomSecretsData } from './schemas/game-schemas'
import { createActionTools } from './server/action-routes'
import type { Env } from '../worker'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case PREPARE_ROOM_JOB:
      return prepareRoom(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}

/** Saved between checks while we wait for indexing (passed to ctx.continue). */
type WaitState = { startedAt: number }

async function prepareRoom(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const { roomId, attempt } = job.payload as PrepareRoomPayload

  // Read the room first, as the app owner, to learn who the host is.
  const ownerTools = createActionTools(env, env.OWNER_USER_ID, '')
  const room = await ownerTools.get<RoomData>('rooms', roomId)
  if (!room.success) return { skipped: 'room not found' }

  // Stop if this job is out of date: the room moved on, or a Retry started a
  // newer attempt. This also makes the job safe to run twice.
  const { status, prepareAttempt } = room.data.record.data
  if (status !== 'preparing' || prepareAttempt !== attempt) return { skipped: 'stale job' }

  const hostId = room.data.record.createdBy
  const tools = createActionTools(env, hostId, '')
  const setRoom = (patch: Partial<RoomData>) => tools.update<RoomData>('rooms', roomId, patch)

  // ---- 1. Wait for indexing ------------------------------------------------
  const wait = (job.resumeFrom as WaitState | undefined) ?? { startedAt: Date.now() }
  const indexing = await indexingState(env, roomId)

  if (indexing === 'failed') {
    await setRoom({ status: 'error', failReason: 'Indexing the document failed. Press Retry.' })
    return { outcome: 'error', reason: 'indexing failed' }
  }
  if (indexing === 'waiting') {
    if (Date.now() - wait.startedAt > INDEX_TIMEOUT_MS) {
      await setRoom({ status: 'error', failReason: 'Indexing took longer than 2 minutes. Press Retry.' })
      return { outcome: 'error', reason: 'indexing timed out' }
    }
    ctx.progress(Math.min(0.5, (Date.now() - wait.startedAt) / INDEX_TIMEOUT_MS), 'Indexing')
    ctx.continue(wait, { afterMs: INDEX_POLL_MS }) // run this job again shortly
    return
  }

  // ---- 2. Generate questions ----------------------------------------------
  const indexedAfterMs = Date.now() - wait.startedAt
  console.info(`[prepare-room] room=${roomId} indexed after ${Math.round(indexedAfterMs / 1000)}s`)
  ctx.progress(0.6, 'Writing questions')
  const aiStartedAt = Date.now()
  const secrets = await getSecrets(tools, roomId)
  if (!secrets?.data.sourceText) {
    await setRoom({ status: 'error', failReason: 'Room data is missing. Please create a new game.' })
    return { outcome: 'error', reason: 'missing secrets' }
  }

  let generated
  try {
    generated = await generateQuestions(env, secrets.data.sourceText)
  } catch (error) {
    console.error('[prepare-room] AI call failed', error)
    await setRoom({ status: 'error', failReason: 'The AI could not write questions just now. Press Retry.' })
    return { outcome: 'error', reason: 'ai failed' }
  }

  console.info(
    `[prepare-room] room=${roomId} AI took ${Math.round((Date.now() - aiStartedAt) / 1000)}s, ` +
      `usable=${generated.usable}, questions=${generated.questions.length}`,
  )

  if (!generated.usable) {
    await setRoom({ status: 'failed', failReason: generated.reason || 'This document cannot make a game.' })
    return { outcome: 'failed', reason: 'unusable' }
  }

  // ---- 3. Verify answers against the document ------------------------------
  ctx.progress(0.8, 'Checking answers')
  const verified = await verifyQuestions(generated.questions, (query) => searchRoom(env, roomId, query))
  const answersBefore = generated.questions.reduce((n, q) => n + q.answers.length, 0)
  const answersAfter = verified.reduce((n, q) => n + q.answers.length, 0)
  console.info(
    `[prepare-room] room=${roomId} verified ${verified.length}/${generated.questions.length} questions, ` +
      `${answersAfter}/${answersBefore} answers`,
  )

  if (verified.length < MIN_PLAYABLE_QUESTIONS) {
    await setRoom({ status: 'failed', failReason: 'Not enough content in this document to make a game.' })
    return { outcome: 'failed', reason: `only ${verified.length} questions verified` }
  }

  // ---- 4. Save questions + answer keys, open the lobby ---------------------
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
  return { outcome: 'lobby', questions: verified.length }
}
