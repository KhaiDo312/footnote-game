/**
 * End-to-end room preparation: upload → indexing → AI questions → verified
 * answers → lobby. And the "not enough content" path for a nonsense document.
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

test.describe.configure({ timeout: 7 * 60_000 })

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** Re-reads the room every 3 s until it leaves 'preparing' (up to 6 minutes). */
async function waitUntilPrepared(baseURL: string, token: string, roomId: string): Promise<Room> {
  let room: Room | undefined
  await expect
    .poll(
      async () => {
        const rows = await readAs<Room>(baseURL, token, 'rooms', { recordId: roomId })
        room = rows[0]?.data
        return room?.status
      },
      { timeout: 6 * 60_000, intervals: [3_000] },
    )
    .toMatch(/^(lobby|failed|error)$/)
  return room!
}

type Room = { status: string; failReason?: string; joinCode: string; questionCount?: number }
type Question = { roomId: string; index: number; prompt: string; visibility: string }

test('a real document becomes a lobby with hidden questions and server-only answers', async ({
  request,
  playwright,
  baseURL,
}) => {
  const host = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
  // A second, separate cookie jar so the two accounts don't share a session.
  const otherRequest = await playwright.request.newContext({ baseURL })
  const outsider = await signInAndGetToken(otherRequest, baseURL!, 'Footnote Player B')

  const created = await callActionAs<{ roomId: string; joinCode: string }>(request, host.token, 'createRoom', {
    title: `__test-${Date.now()}__ Harbor market`,
    text: fixture('harbor-market.md'),
  })
  expect(created, JSON.stringify(created)).toMatchObject({ success: true })
  const { roomId, joinCode } = created.data!
  expect(joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/)

  try {
    // Wait for the job: preparing → lobby (or show why not).
    const room = await waitUntilPrepared(baseURL!, host.token, roomId)
    expect(room.status, `failReason: ${room.failReason}`).toBe('lobby')
    expect(room.questionCount).toBeGreaterThanOrEqual(3)

    // The host (owner of the question rows) sees every question, still hidden.
    const hostQuestions = await readAs<Question>(baseURL!, host.token, 'questions', { roomId })
    expect(hostQuestions).toHaveLength(room.questionCount!)
    for (const q of hostQuestions) {
      expect(q.data.visibility).toBe('hidden')
      expect(q.data.prompt.length).toBeGreaterThan(10)
    }

    // Someone else can't read this room or its hidden questions.
    expect(await readAs(baseURL!, outsider.token, 'rooms', { recordId: roomId })).toEqual([])
    expect(await readAs(baseURL!, outsider.token, 'questions', { roomId })).toEqual([])

    // Nobody but the server can read the answer keys, not even the host.
    expect(await readAs(baseURL!, host.token, 'roomSecrets', { roomId })).toEqual([])
    expect(await readAs(baseURL!, outsider.token, 'roomSecrets', { roomId })).toEqual([])
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
    const room = await waitUntilPrepared(baseURL!, host.token, roomId)
    expect(room.status).toBe('failed')
    expect(room.failReason?.length).toBeGreaterThan(5)
  } finally {
    await callActionAs(request, host.token, 'endRoom', { roomId })
  }
})
