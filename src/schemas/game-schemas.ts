/**
 * Footnote game collections. See PLAN.md §1 for the reasoning.
 *
 * Rule for every collection here: browsers NEVER write. All writes go through
 * server actions (src/actions/), so `member` has create/update/delete = false
 * everywhere. Browsers only read via useQuery, and the `read` rule decides
 * what each person receives. `admin` (the app owner) has full access for debugging.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'
import type { QuestionResults } from '../game/scoring'

/** Room states. PLAN.md §6 has the diagram. */
export const ROOM_STATUSES = [
  'preparing', // the AI is writing questions; answers are being checked
  'lobby', // questions ready, waiting for the host to start
  'question', // a question is live, timer running
  'reveal', // showing results for the current question
  'finished', // final scoreboard
  'failed', // document can't make a game (final; host makes a new room)
  'error', // technical problem (e.g. the AI call failed); host can Retry
] as const
export type RoomStatus = (typeof ROOM_STATUSES)[number]

/**
 * The search index, tracked separately from the room status because the lobby
 * opens before indexing finishes. It is only needed to judge answers that are
 * not on the list, so the host can start once it is 'ready'.
 */
export const INDEX_STATUSES = ['indexing', 'ready', 'failed'] as const
export type IndexStatus = (typeof INDEX_STATUSES)[number]

export const ANSWER_TIERS = ['common', 'uncommon', 'niche', 'none'] as const
export type AnswerTier = (typeof ANSWER_TIERS)[number]

/**
 * listed     on the answer list
 * supported  not on the list, but the AI judge found it in the document (Day 4)
 * rejected   not on the list, and the judge says the document doesn't support it
 * unchecked  not on the list, and we couldn't check it (judge failed or timed
 *            out, no search index, or before Day 4). 0 points, shown as
 *            "couldn't check" rather than as wrong.
 */
export const VERDICTS = ['listed', 'supported', 'rejected', 'unchecked'] as const
export type Verdict = (typeof VERDICTS)[number]

// Shared permission rows, so each schema below only says what is different.
const noAccess: RolePermissions = { read: false, create: false, update: false, delete: false }
const adminAll: RolePermissions = { read: true, create: true, update: true, delete: true }
const readOnly = (read: RolePermissions['read']): RolePermissions => ({
  read,
  create: false,
  update: false,
  delete: false,
})

/** One game. Readable by its host (the creator) and anyone listed in playerIds. */
export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', maxLength: 120 },
    { name: 'joinCode', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...ROOM_STATUSES] } },
    { name: 'failReason', storage: 'text', interpretation: 'plain' },
    { name: 'playerIds', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'questionCount', storage: 'number', interpretation: 'plain' },
    { name: 'currentIndex', storage: 'number', interpretation: 'plain' },
    { name: 'currentQuestionId', storage: 'text', interpretation: 'plain' },
    { name: 'questionEndsAt', storage: 'number', interpretation: 'plain' },
    { name: 'prepareAttempt', storage: 'number', interpretation: 'plain' },
    { name: 'indexStatus', storage: 'text', interpretation: { kind: 'select', options: [...INDEX_STATUSES] } },
    { name: 'indexAttempt', storage: 'number', interpretation: 'plain' },
    { name: 'indexFailures', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['joinCode'],
  collaboratorsField: 'playerIds',
  permissions: {
    viewer: noAccess,
    member: readOnly('shared'), // host (creator) or a user id in playerIds
    admin: adminAll,
  },
}

/** Who is in a room, and their running score. */
export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', maxLength: 80 },
    { name: 'score', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['roomId', 'userId'], // a player joins a room once
  permissions: {
    viewer: noAccess,
    member: readOnly(true), // names and scores only
    admin: adminAll,
  },
}

/**
 * Question prompts. Hidden from players until the host makes them live.
 * The answer list is NOT here; it stays in roomSecrets until reveal.
 */
export const questionsSchema: CollectionSchema = {
  name: 'questions',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'index', storage: 'number', interpretation: 'plain' },
    { name: 'prompt', storage: 'text', interpretation: 'plain' },
    { name: 'visibility', storage: 'text', interpretation: { kind: 'select', options: ['hidden', 'shown'] } },
    { name: 'results', storage: 'text', interpretation: { kind: 'json' } }, // written at reveal
  ],
  visibilityField: { field: 'visibility', value: 'shown' },
  permissions: {
    viewer: noAccess,
    member: readOnly('published'), // host (creator) always; others once shown
    admin: adminAll,
  },
}

/** One player's answer to one question. Players only ever see their own. */
export const submissionsSchema: CollectionSchema = {
  name: 'submissions',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'questionId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'text', storage: 'text', interpretation: 'plain', maxLength: 80 },
    { name: 'normalized', storage: 'text', interpretation: 'plain' },
    { name: 'verdict', storage: 'text', interpretation: { kind: 'select', options: [...VERDICTS] } },
    { name: 'tier', storage: 'text', interpretation: { kind: 'select', options: [...ANSWER_TIERS] } },
    { name: 'quote', storage: 'text', interpretation: 'plain' },
    { name: 'points', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['questionId', 'userId'], // one answer per player per question
  ownerField: 'userId', // 'own' below means "this submission's userId is me"
  permissions: {
    viewer: noAccess,
    member: readOnly('own'),
    admin: adminAll,
  },
}

/**
 * Server-only data: the full document text, knowledge item ids, and the
 * verified answer keys. No player or host can read this; only server code
 * (actions and jobs, which run with RBAC off) and the app owner.
 */
export const roomSecretsSchema: CollectionSchema = {
  name: 'roomSecrets',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'sourceText', storage: 'text', interpretation: 'plain' },
    { name: 'knowledgeItemIds', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'answerKeys', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['roomId'],
  permissions: {
    viewer: noAccess,
    member: noAccess,
    admin: adminAll,
  },
}

// ---------------------------------------------------------------------------
// TypeScript shapes of each collection's `record.data`, shared by the browser
// and server code. Fields are optional because a row may be read before the
// server has filled them in. (These are `type`s rather than `interface`s
// because the SDK's record tools need a plain object type.)
// ---------------------------------------------------------------------------

export type RoomData = {
  title?: string
  joinCode?: string
  status?: RoomStatus
  failReason?: string
  playerIds?: string[]
  questionCount?: number
  currentIndex?: number
  currentQuestionId?: string
  questionEndsAt?: number
  prepareAttempt?: number
  indexStatus?: IndexStatus
  /** Goes up on each indexing Retry, so an older indexing job knows to stop. */
  indexAttempt?: number
  /** How many indexing attempts failed. At 2, the host may start anyway. */
  indexFailures?: number
}

export type PlayerData = { roomId?: string; userId?: string; name?: string; score?: number }

export type QuestionData = {
  roomId?: string
  index?: number
  prompt?: string
  visibility?: 'hidden' | 'shown'
  /** Written at reveal (src/game/scoring.ts). Null until then. */
  results?: QuestionResults | null
}

export type SubmissionData = {
  roomId?: string
  questionId?: string
  userId?: string
  text?: string
  normalized?: string
  /** The four fields below are filled in at reveal. */
  verdict?: Verdict
  tier?: AnswerTier
  quote?: string
  points?: number
}

export type RoomSecretsData = {
  roomId?: string
  sourceText?: string
  knowledgeItemIds?: string[]
  /** questionId → verified answers (see src/game/verify.ts AnswerKeyEntry). */
  answerKeys?: Record<string, unknown[]>
}

export const gameSchemas: CollectionSchema[] = [
  roomsSchema,
  playersSchema,
  questionsSchema,
  submissionsSchema,
  roomSecretsSchema,
]
