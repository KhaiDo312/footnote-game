import { test, expect } from '@playwright/test'
import { appScopeId, signInAndGetToken } from './helpers/auth'
import { callActionAs } from './helpers/records'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

// ---------------------------------------------------------------------------
// Footnote room actions. These checks never reach the AI, so they cost nothing.
// Needs the test account "Footnote Player A" (npx deepspace test accounts list).
// ---------------------------------------------------------------------------

test.describe('Room actions', () => {
  test('createRoom requires sign-in', async ({ request }) => {
    const res = await request.post('/api/actions/createRoom', { data: { title: 'x', text: 'y' } })
    expect(res.status()).toBe(401)
  })

  test('createRoom rejects a document that is too short or too long', async ({ request, baseURL }) => {
    const { token } = await signInAndGetToken(request, baseURL!, 'Footnote Player A')

    const short = await callActionAs(request, token, 'createRoom', { title: 'Short', text: 'Too short.' })
    expect(short).toMatchObject({ success: false })
    expect(short.error).toContain('too short')

    const long = await callActionAs(request, token, 'createRoom', { title: 'Long', text: 'a'.repeat(50_001) })
    expect(long).toMatchObject({ success: false })
    expect(long.error).toContain('too long')
  })

  test('host actions refuse a room the caller does not host', async ({ request, baseURL }) => {
    const { token } = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
    for (const name of ['retryPrepare', 'retryIndex', 'endRoom', 'nextQuestion', 'revealQuestion']) {
      const result = await callActionAs(request, token, name, { roomId: 'no-such-room' })
      expect(result, name).toMatchObject({ success: false, error: 'Room not found.' })
    }
  })
})

test.describe('Game actions', () => {
  test('joinRoom refuses malformed and unknown codes', async ({ request, baseURL }) => {
    const { token } = await signInAndGetToken(request, baseURL!, 'Footnote Player B')
    const malformed = await callActionAs(request, token, 'joinRoom', { joinCode: 'OIL12' })
    expect(malformed.error).toContain('doesn’t look right')
    // Valid letters, but (almost certainly) no room has this code.
    const unknown = await callActionAs(request, token, 'joinRoom', { joinCode: 'ZZZZZ' })
    expect(unknown).toMatchObject({ success: false, error: 'No game has that code.' })
  })

  test('submitAnswer validates the answer before anything else', async ({ request, baseURL }) => {
    const { token } = await signInAndGetToken(request, baseURL!, 'Footnote Player B')
    const empty = await callActionAs(request, token, 'submitAnswer', { roomId: 'x', questionId: 'y', text: '  ' })
    expect(empty.error).toBe('Type an answer first.')
    const long = await callActionAs(request, token, 'submitAnswer', { roomId: 'x', questionId: 'y', text: 'a'.repeat(81) })
    expect(long.error).toContain('at most 80')
    const missing = await callActionAs(request, token, 'submitAnswer', { roomId: 'x', questionId: 'y', text: 'hi' })
    expect(missing).toMatchObject({ success: false, error: 'Room not found.' })
  })
})

// ---------------------------------------------------------------------------
// Security: a normal signed-in player must NOT be able to start a background
// job. Only server code (the room actions, via enqueueJob) may,
// because jobs spend the app owner's AI credits. See AppJobRoom in worker.ts.
// ---------------------------------------------------------------------------

type WireMessage = { type: string; payload?: Record<string, unknown> }

/** Opens a WebSocket and records every JSON message it receives. */
async function openSocket(url: string): Promise<{ socket: WebSocket; messages: WireMessage[] }> {
  const messages: WireMessage[] = []
  const socket = new WebSocket(url)
  socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error(`WebSocket failed to open: ${url}`)))
  })
  return { socket, messages }
}

test('a normal player cannot enqueue a job over the job WebSocket', async ({ request, baseURL }) => {
  const { token } = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
  const wsBase = baseURL!.replace(/^http/, 'ws')
  const scope = encodeURIComponent(await appScopeId())

  // 1. Connect to the app's records room, as every signed-in page does. This
  //    registers the account as a `member`, which is the role a real player has.
  //    (Without this step the account has no role yet and is refused for that
  //    reason alone, which would make this test pass for the wrong reason.)
  const records = await openSocket(`${wsBase}/ws/${scope}?token=${token}`)
  await expect.poll(() => records.messages.length).toBeGreaterThan(0)
  records.socket.close()

  // 2. Open the job room and try to start a job, as a malicious client would.
  const jobs = await openSocket(`${wsBase}/ws/jobs/${scope}?token=${token}`)
  try {
    await expect.poll(() => jobs.messages.find((m) => m.type === 'auth')).toBeTruthy()
    jobs.socket.send(
      JSON.stringify({
        type: 'job.enqueue',
        payload: { type: 'prepare-room', payload: { roomId: '__test__' }, requestId: 'probe-1' },
      }),
    )

    // 3. The server refuses it...
    await expect
      .poll(() => jobs.messages.find((m) => m.type === 'core.error')?.payload?.error)
      .toContain('Write access denied')

    // ...told this connection it can't write...
    const auths = jobs.messages.filter((m) => m.type === 'auth')
    expect(auths.every((m) => m.payload?.canWrite === false)).toBe(true)

    // ...and never reported a job as enqueued.
    const enqueued = jobs.messages.filter((m) => m.type === 'job.update' && m.payload?.kind === 'enqueued')
    expect(enqueued).toEqual([])
  } finally {
    jobs.socket.close()
  }
})
