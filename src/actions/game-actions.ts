/**
 * Gameplay server actions (PLAN.md §2): joinRoom, nextQuestion, submitAnswer,
 * revealQuestion.
 *
 * Like the room actions, these run with RBAC off, so every check is here.
 * None of them adds to a stored number: they write final values (a score is
 * the sum of the player's submission points), so running one twice, or two
 * at the same moment, gives the same result. Duplicate joins and answers are
 * refused by the database itself (uniqueOn in src/schemas/game-schemas.ts).
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { askJudge } from '../game/ai'
import { JUDGE_PASSAGES, LATE_ANSWER_GRACE_MS, MAX_ANSWER_CHARS, QUESTION_SECONDS } from '../game/config'
import { judgeOffList, type FinalVerdict, type JudgeDeps } from '../game/judge'
import { normalizeJoinCode } from '../game/join-code'
import { normalizeAnswer } from '../game/normalize'
import { searchRoom } from '../game/knowledge'
import { matchAnswerKey, scoreQuestion, type QuestionResults } from '../game/scoring'
import { canStart } from '../game/start-rules'
import type { AnswerKeyEntry } from '../game/verify'
import type { PlayerData, QuestionData, RoomData, SubmissionData, VerdictData } from '../schemas/game-schemas'
import { getSecrets } from './room-actions'

// ---------------------------------------------------------------------------
// joinRoom: { joinCode } → { roomId, isHost }
// ---------------------------------------------------------------------------

export const joinRoom: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const joinCode = normalizeJoinCode(String(params.joinCode ?? ''))
  if (!joinCode) return fail('That code doesn’t look right. Codes are 5 letters, like KQXTR.')

  const found = await tools.query<RoomData>('rooms', { where: { joinCode }, limit: 1 })
  if (!found.success) return found
  const room = found.data.records[0]
  if (!room) return fail('No game has that code.')
  if (room.data.status === 'finished' || room.data.status === 'failed') return fail('This game has ended.')

  // The host is sent straight to their room; they don't play.
  if (room.createdBy === userId) return { success: true, data: { roomId: room.recordId, isHost: true } }

  // The name comes from the server's users row (decoded correctly, unlike
  // the browser's token decoder: NOTES.md SDK feedback #1).
  const user = await tools.get<{ name?: string }>('users', userId)
  const name = (user.success ? user.data.record.data.name : '')?.trim().slice(0, 80) || 'Player'

  // uniqueOn ['roomId', 'userId'] refuses a second row, so joining twice
  // (two tabs, a double-click) is fine: we just carry on.
  const created = await tools.create<PlayerData>('players', { roomId: room.recordId, userId, name, score: 0 })
  if (!created.success && !created.error.includes('Duplicate')) return created

  const synced = await syncPlayerIds(tools, room.recordId)
  if (!synced.success) return synced
  return { success: true, data: { roomId: room.recordId, isHost: false } }
}

// ---------------------------------------------------------------------------
// nextQuestion: { roomId } → { status }. Lobby → question 1, reveal → next
// question, or after the last reveal → finished.
// ---------------------------------------------------------------------------

export const nextQuestion: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const loaded = await loadAsHost(tools, userId, params.roomId)
  if (!loaded.success) return loaded
  const { roomId, room } = loaded.data

  // A second click arrives after the first moved the room to 'question'.
  if (room.status === 'question') return fail('Already moved on.')
  if (room.status !== 'lobby' && room.status !== 'reveal') return fail('The game can’t move on from here.')
  if (room.status === 'lobby' && !canStart(room)) return fail('The answer checker isn’t ready yet.')

  await syncPlayerIds(tools, roomId) // repairs a player lost to a join race

  const next = (room.currentIndex ?? -1) + 1
  if (next >= (room.questionCount ?? 0)) {
    const done = await tools.update<RoomData>('rooms', roomId, { status: 'finished' })
    return done.success ? { success: true, data: { status: 'finished' } } : done
  }

  const found = await tools.query<QuestionData>('questions', { where: { roomId, index: next }, limit: 1 })
  if (!found.success) return found
  const question = found.data.records[0]
  if (!question) return fail('Question not found.')

  // Show the question first, then point the room at it, so a player's page
  // never points at a question it can't read yet. Two clicks at the same
  // moment both write these same values, so nothing is skipped.
  const shown = await tools.update<QuestionData>('questions', question.recordId, { visibility: 'shown' })
  if (!shown.success) return shown
  const moved = await tools.update<RoomData>('rooms', roomId, {
    status: 'question',
    currentIndex: next,
    currentQuestionId: question.recordId,
    questionEndsAt: Date.now() + QUESTION_SECONDS * 1000, // the server's clock decides
  })
  return moved.success ? { success: true, data: { status: 'question' } } : moved
}

// ---------------------------------------------------------------------------
// submitAnswer: { roomId, questionId, text } → { locked: true }
// The answer is only stored here; it is scored at reveal.
// ---------------------------------------------------------------------------

export const submitAnswer: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const questionId = String(params.questionId ?? '')
  const text = String(params.text ?? '').trim()
  if (!text) return fail('Type an answer first.')
  if (text.length > MAX_ANSWER_CHARS) return fail(`Answers can be at most ${MAX_ANSWER_CHARS} characters.`)
  const normalized = normalizeAnswer(text)
  if (!normalized) return fail('Use letters or numbers in your answer.')

  const got = await tools.get<RoomData>('rooms', roomId)
  if (!got.success) return fail('Room not found.')
  const room = got.data.record
  if (room.createdBy === userId) return fail('The host doesn’t answer.')

  const me = await tools.query<PlayerData>('players', { where: { roomId, userId }, limit: 1 })
  if (!me.success) return me
  if (me.data.records.length === 0) return fail('Join this game first.')

  if (room.data.status !== 'question' || room.data.currentQuestionId !== questionId) {
    return fail('This question is closed.')
  }
  if (Date.now() > (room.data.questionEndsAt ?? 0) + LATE_ANSWER_GRACE_MS) return fail('Time is up.')

  // uniqueOn ['questionId', 'userId']: the database refuses a second answer,
  // even if two arrive at the same moment. The first one stands.
  const created = await tools.create<SubmissionData>('submissions', { roomId, questionId, userId, text, normalized })
  if (!created.success) {
    if (created.error.includes('Duplicate')) return { success: true, data: { locked: true, alreadyAnswered: true } }
    return created
  }
  return { success: true, data: { locked: true, alreadyAnswered: false } }
}

// ---------------------------------------------------------------------------
// revealQuestion: { roomId } → { results }
// ---------------------------------------------------------------------------

export const revealQuestion: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const loaded = await loadAsHost(tools, userId, params.roomId)
  if (!loaded.success) return loaded
  const { roomId, room } = loaded.data
  const questionId = room.currentQuestionId ?? ''

  if (room.status !== 'question' && room.status !== 'reveal') return fail('There is no question to reveal.')

  const question = await tools.get<QuestionData>('questions', questionId)
  if (!question.success) return fail('Question not found.')
  // Already revealed: return the saved results (a double-click, or a retry).
  if (room.status === 'reveal' && question.data.record.data.results) {
    return { success: true, data: { results: question.data.record.data.results } }
  }

  // Close the question first, so no new answers arrive while we score.
  if (room.status === 'question') {
    const closed = await tools.update<RoomData>('rooms', roomId, { status: 'reveal' })
    if (!closed.success) return closed
  }

  const [subs, players, secrets] = await Promise.all([
    tools.query<SubmissionData>('submissions', { where: { questionId }, limit: 500 }),
    tools.query<PlayerData>('players', { where: { roomId }, limit: 500 }),
    getSecrets(tools, roomId),
  ])
  if (!subs.success) return subs
  if (!players.success) return players
  const answerKey = (secrets?.data.answerKeys?.[questionId] ?? []) as AnswerKeyEntry[]

  const names = Object.fromEntries(players.data.records.map((p) => [p.data.userId ?? '', p.data.name ?? 'Player']))
  const inputs = subs.data.records.map((s) => ({
    userId: s.data.userId ?? '',
    text: s.data.text ?? '',
    normalized: s.data.normalized ?? '',
  }))

  // The AI judge, for answers not on the list (src/game/judge.ts). It never
  // throws: anything it can't check scores 0 as "Couldn't check".
  const prompt = question.data.record.data.prompt ?? ''
  const started = Date.now()
  const { verdicts: offList, log } = await judgeOffList(
    prompt,
    inputs.filter((s) => matchAnswerKey(s.normalized, answerKey) < 0),
    judgeDeps(env, tools, roomId, questionId),
    { indexReady: (room.indexStatus ?? 'ready') === 'ready' }, // undefined: rooms from before Nov 22
  )
  if (Object.keys(log).length > 0) {
    console.log(`[judge] room=${roomId} q=${questionId} ${Date.now() - started}ms ${JSON.stringify(log)}`)
  }
  const { scored, results } = scoreQuestion(inputs, answerKey, offList, names)

  // Save each player's verdict and points on their submission.
  const subIdByUser = new Map(subs.data.records.map((s) => [s.data.userId ?? '', s.recordId]))
  await Promise.all(
    scored.map((s) =>
      tools.update<SubmissionData>('submissions', subIdByUser.get(s.userId)!, {
        verdict: s.verdict,
        tier: s.tier,
        points: s.points,
        quote: s.quote,
      }),
    ),
  )

  // Totals: each score is set to the sum of that player's points so far,
  // never incremented, so revealing twice can't double-count.
  const all = await tools.query<SubmissionData>('submissions', { where: { roomId }, limit: 500 })
  if (!all.success) return all
  const totals = new Map<string, number>()
  for (const s of all.data.records) {
    const id = s.data.userId ?? ''
    totals.set(id, (totals.get(id) ?? 0) + (s.data.points ?? 0))
  }
  await Promise.all(
    players.data.records.map((p) =>
      tools.update<PlayerData>('players', p.recordId, { score: totals.get(p.data.userId ?? '') ?? 0 }),
    ),
  )

  const saved = await tools.update<QuestionData>('questions', questionId, { results })
  if (!saved.success) return saved
  return { success: true, data: { results: results satisfies QuestionResults } }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Loads a room and checks the caller is its host. */
async function loadAsHost(
  tools: ActionTools,
  userId: string,
  roomIdParam: unknown,
): Promise<ActionResult<{ roomId: string; room: RoomData }>> {
  const roomId = String(roomIdParam ?? '')
  const got = await tools.get<RoomData>('rooms', roomId)
  if (!got.success) return fail('Room not found.')
  if (got.data.record.createdBy !== userId) return fail('Only the host can do that.')
  return { success: true, data: { roomId, room: got.data.record.data } }
}

/** The judge's search, AI and verdict storage for one question. */
function judgeDeps(env: Env, tools: ActionTools, roomId: string, questionId: string): JudgeDeps {
  return {
    search: (query) => searchRoom(env, roomId, query, JUDGE_PASSAGES),
    ask: (prompt, signal) => askJudge(env, prompt, signal),
    loadSaved: async () => {
      const found = await tools.query<VerdictData>('verdicts', { where: { questionId }, limit: 500 })
      if (!found.success) throw new Error(found.error)
      return Object.fromEntries(found.data.records.map((r) => [r.data.normalized ?? '', toFinal(r.data)]))
    },
    save: async (normalized, { verdict, quote }) => {
      const created = await tools.create<VerdictData>('verdicts', { roomId, questionId, normalized, verdict, quote })
      if (created.success || !created.error.includes('Duplicate')) return { verdict, quote }
      // Another reveal saved first (uniqueOn): use theirs, so both agree.
      const theirs = await tools.query<VerdictData>('verdicts', { where: { questionId, normalized }, limit: 1 })
      const record = theirs.success ? theirs.data.records[0] : undefined
      return record ? toFinal(record.data) : { verdict, quote }
    },
  }
}

function toFinal(data: VerdictData): FinalVerdict {
  return { verdict: data.verdict === 'supported' ? 'supported' : 'rejected', quote: data.quote ?? '' }
}

/**
 * Makes rooms.playerIds (which decides who can read the room) list everyone
 * with a players row. The SDK has no "add to list" operation, so two people
 * joining at the same moment can each write a list missing the other. The
 * players rows can't be lost (uniqueOn), so we rebuild from them, check, and
 * try again; nextQuestion also calls this, as a repair.
 */
async function syncPlayerIds(tools: ActionTools, roomId: string): Promise<ActionResult<null>> {
  for (let tries = 0; tries < 3; tries++) {
    const [room, players] = await Promise.all([
      tools.get<RoomData>('rooms', roomId),
      tools.query<PlayerData>('players', { where: { roomId }, limit: 500 }),
    ])
    if (!room.success) return room
    if (!players.success) return players

    const current = room.data.record.data.playerIds ?? []
    const missing = players.data.records.map((p) => p.data.userId ?? '').filter((id) => id && !current.includes(id))
    if (missing.length === 0) return { success: true, data: null }

    const updated = await tools.update<RoomData>('rooms', roomId, { playerIds: [...current, ...missing] })
    if (!updated.success) return updated
    // Loop: read again to check another join didn't overwrite our write.
  }
  return { success: true, data: null }
}

function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// TEMPORARY experiment (Nov 23): does a hyphen in the query empty the search?
// Host-only. Removed once answered.
export const debugSearch: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const loaded = await loadAsHost(tools, userId, params.roomId)
  if (!loaded.success) return loaded
  const queries = (params.queries as string[]) ?? []
  const out: Record<string, number | string> = {}
  for (const q of queries) {
    try {
      out[q] = (await searchRoom(env, loaded.data.roomId, q, 5)).length
    } catch (e) {
      out[q] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return { success: true, data: out }
}
