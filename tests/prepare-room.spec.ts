/**
 * End-to-end room preparation: AI questions → verified answers → lobby
 * (seconds), while the search index builds separately → indexStatus 'ready'
 * (~2 minutes). And the "not enough content" path for a nonsense document.
 *
 * COSTS CREDITS: each run makes real AI and knowledge calls billed to the
 * app owner (a few cents). It is NOT in the default suite; run it on purpose:
 *   npx deepspace test run tests/prepare-room.spec.ts
 *
 * Needs test accounts "Footnote Player A" (host) and "Footnote Player B".
 */

import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signInAndGetToken } from './helpers/auth'
import { callActionAs, readAs } from './helpers/records'

test.describe.configure({ timeout: 8 * 60_000 })

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

type Room = {
  status: string
  failReason?: string
  joinCode: string
  questionCount?: number
  indexStatus?: string
  indexFailures?: number
}
type Question = { roomId: string; index: number; prompt: string; visibility: string }

/** Re-reads the room every second until `done(room)` is true. */
async function waitForRoom(
  baseURL: string,
  token: string,
  roomId: string,
  done: (room: Room) => boolean,
  timeoutMs: number,
): Promise<Room> {
  let room: Room | undefined
  await expect
    .poll(
      async () => {
        const rows = await readAs<Room>(baseURL, token, 'rooms', { recordId: roomId })
        room = rows[0]?.data
        return room ? done(room) : false
      },
      { timeout: timeoutMs, intervals: [1_000] },
    )
    .toBe(true)
  return room!
}

const leftPreparing = (room: Room) => room.status !== 'preparing'

test('a real document opens the lobby before indexing finishes, with hidden questions', async ({
  request,
  playwright,
  baseURL,
}) => {
  const host = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
  // A second, separate cookie jar so the two accounts don't share a session.
  const otherRequest = await playwright.request.newContext({ baseURL })
  const outsider = await signInAndGetToken(otherRequest, baseURL!, 'Footnote Player B')

  const startedAt = Date.now()
  const created = await callActionAs<{ roomId: string; joinCode: string }>(request, host.token, 'createRoom', {
    title: `__test-${Date.now()}__ Harbor market`,
    text: fixture('harbor-market.md'),
  })
  expect(created, JSON.stringify(created)).toMatchObject({ success: true })
  const { roomId, joinCode } = created.data!
  expect(joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/)

  try {
    // 1. The lobby opens without waiting for the index.
    const room = await waitForRoom(baseURL!, host.token, roomId, leftPreparing, 2 * 60_000)
    const lobbySeconds = (Date.now() - startedAt) / 1000
    console.log(`[timing] Create pressed → lobby: ${lobbySeconds.toFixed(1)}s (index: ${room.indexStatus})`)
    expect(room.status, `failReason: ${room.failReason}`).toBe('lobby')
    expect(room.questionCount).toBeGreaterThanOrEqual(3)
    expect(lobbySeconds).toBeLessThan(90)

    // 2. The host (owner of the question rows) sees every question, still hidden.
    const hostQuestions = await readAs<Question>(baseURL!, host.token, 'questions', { roomId })
    expect(hostQuestions).toHaveLength(room.questionCount!)
    for (const q of hostQuestions) {
      expect(q.data.visibility).toBe('hidden')
      expect(q.data.prompt.length).toBeGreaterThan(10)
    }

    // 3. Someone else can't read this room or its hidden questions.
    expect(await readAs(baseURL!, outsider.token, 'rooms', { recordId: roomId })).toEqual([])
    expect(await readAs(baseURL!, outsider.token, 'questions', { roomId })).toEqual([])

    // 4. Nobody but the server can read the answer keys, not even the host.
    expect(await readAs(baseURL!, host.token, 'roomSecrets', { roomId })).toEqual([])
    expect(await readAs(baseURL!, outsider.token, 'roomSecrets', { roomId })).toEqual([])

    // 5. Retry is refused while indexing hasn't failed.
    if (room.indexStatus !== 'failed') {
      const retry = await callActionAs(request, host.token, 'retryIndex', { roomId })
      expect(retry).toMatchObject({ success: false, error: 'The answer checker has not failed.' })
    }

    // 6. The index finishes on its own, in the background.
    const indexed = await waitForRoom(baseURL!, host.token, roomId, (r) => r.indexStatus !== 'indexing', 6 * 60_000)
    console.log(`[timing] Create pressed → index ${indexed.indexStatus}: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    expect(indexed.indexStatus).toBe('ready')
    expect(indexed.status).toBe('lobby')
  } finally {
    await callActionAs(request, host.token, 'endRoom', { roomId })
    await otherRequest.dispose()
  }
})

test('a nonsense document ends as "failed" with a reason', async ({ request, baseURL }) => {
  const host = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
  const created = await callActionAs<{ roomId: string }>(request, host.token, 'createRoom', {
    title: `__test-${Date.now()}__ Nonsense`,
    text: fixture('nonsense.txt'),
  })
  expect(created, JSON.stringify(created)).toMatchObject({ success: true })
  const { roomId } = created.data!

  try {
    const room = await waitForRoom(baseURL!, host.token, roomId, leftPreparing, 2 * 60_000)
    expect(room.status).toBe('failed')
    expect(room.failReason?.length).toBeGreaterThan(5)
  } finally {
    await callActionAs(request, host.token, 'endRoom', { roomId })
  }
})
