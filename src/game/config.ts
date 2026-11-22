/**
 * Footnote game settings — every tunable value lives here.
 *
 * To switch the AI model, change AI_MODEL. It is used by every AI call
 * (question generation and answer judging); nothing else names a model.
 * Valid ids are listed in node_modules/deepspace/dist/worker.d.ts
 * (search for DEEPSPACE_AI_MODELS).
 */

/** The one model used for all AI calls. The app owner pays for these. */
export const AI_MODEL = 'claude-haiku-5-5'

/** Longest document a host may upload or paste, in characters. */
export const MAX_SOURCE_CHARS = 50_000

/** Shortest document worth indexing, in characters. */
export const MIN_SOURCE_CHARS = 200

/** Cost cap: rooms a host may have that are not finished or failed. */
export const MAX_ACTIVE_ROOMS_PER_HOST = 3

/** How many questions we ask the AI for, and the fewest we will play with. */
export const QUESTIONS_REQUESTED = 5
export const MIN_PLAYABLE_QUESTIONS = 3

/** A question needs at least this many verified answers to be kept. */
export const MIN_ANSWERS_PER_QUESTION = 2

/** Cap on the AI's reply length. Keeps the credits reserved per call small. */
export const AI_MAX_OUTPUT_TOKENS = 4_000

/** Scoring (PLAN.md §5): base points by tier, plus up to RARITY_BONUS_MAX for rare answers. */
export const TIER_POINTS = { common: 100, uncommon: 200, niche: 300 } as const
/** An answer not on the list that the AI judge found in the document. */
export const SUPPORTED_POINTS = 300
export const RARITY_BONUS_MAX = 100

/** Seconds players get to answer each question. */
export const QUESTION_SECONDS = 30

/** Extra time the server accepts after the timer, for network delay. */
export const LATE_ANSWER_GRACE_MS = 2_000

/** Longest answer a player may type. */
export const MAX_ANSWER_CHARS = 80

/** The search index (used only to judge answers that aren't on the list) is
 *  marked failed after this long; the host can Retry from the lobby.
 *  Measured on the live app (Nov 21): 96 s for a 0.6 KB doc, >120 s for 3 KB. */
export const INDEX_TIMEOUT_MS = 5 * 60_000

/** After this many failed indexing attempts, the host may start without the
 *  index. Answers not on the list then score 0 (NOTES.md has the tradeoff). */
export const INDEX_FAILURES_BEFORE_START_ANYWAY = 2

/** How often the indexing check looks at the knowledge base. */
export const INDEX_POLL_MS = 3_000

/** Join-code letters. O, I and L are left out because they look like 0, 1 and I. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const JOIN_CODE_LENGTH = 5
