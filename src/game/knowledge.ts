/**
 * Managed knowledge (the app's AI Search index), one folder per room.
 * Server-side only. `knowledge(env)` reaches the index through DeepSpace's
 * platform connection; usage is billed to the app owner.
 */

import { knowledge, type KnowledgeStatus } from 'deepspace/worker'
import type { Env } from '../../worker'

/** Every room's document lives in its own folder, so searches never mix rooms. */
export function roomFolder(roomId: string): string {
  return `rooms/${roomId}`
}

/** Uploads the document text. Returns the knowledge item ids to track indexing. */
export async function uploadDocument(env: Env, roomId: string, text: string): Promise<string[]> {
  const file = new File([text], 'source.md', { type: 'text/markdown' })
  const result = await knowledge(env).add(file, { folder: roomFolder(roomId) })
  return result.items.map((item) => item.id)
}

/** Removes old uploads (used before a retry re-uploads). Ignores items already gone. */
export async function removeDocuments(env: Env, itemIds: string[]): Promise<void> {
  const kb = knowledge(env)
  await Promise.all(itemIds.map((id) => kb.remove(id).catch(() => undefined)))
}

/**
 * Summarizes indexing progress for a room's folder:
 * 'ready' when every item is indexed, 'failed' if any item errored,
 * otherwise 'waiting' (including right after upload, before items show up).
 */
export async function indexingState(env: Env, roomId: string): Promise<'ready' | 'waiting' | 'failed'> {
  const { items } = await knowledge(env).list({ folder: roomFolder(roomId), perPage: 50 })
  if (items.length === 0) return 'waiting'
  const statuses = new Set<KnowledgeStatus>(items.map((item) => item.status))
  if (statuses.has('error')) return 'failed'
  return [...statuses].every((s) => s === 'completed') ? 'ready' : 'waiting'
}

/**
 * Search inside one room's folder. Returns the passage texts. 'hybrid' mixes
 * keyword and meaning-based matching, so "Poisson" also finds a passage that
 * says "the Poisson distribution".
 */
export async function searchRoom(env: Env, roomId: string, query: string, limit = 5): Promise<string[]> {
  const result = await knowledge(env).search(query.slice(0, 4_000), {
    folder: roomFolder(roomId),
    mode: 'hybrid',
    limit,
  })
  return result.chunks.map((chunk) => chunk.text)
}
