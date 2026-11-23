// TEMPORARY experiment: hyphen in the search query. Deleted after use.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signInAndGetToken } from './helpers/auth'
import { callActionAs, readAs } from './helpers/records'

test.describe.configure({ timeout: 8 * 60_000 })

test('search with and without hyphens', async ({ request, baseURL }) => {
  const host = await signInAndGetToken(request, baseURL!, 'Footnote Player A')
  const text = readFileSync(new URL('./fixtures/saltmere-almanac.md', import.meta.url), 'utf8')
  const created = await callActionAs<any>(request, host.token, 'createRoom', { title: `__test-${Date.now()}__ search`, text })
  const { roomId } = created.data
  try {
    await expect
      .poll(async () => (await readAs<any>(baseURL!, host.token, 'rooms', { recordId: roomId }))[0]?.data.indexStatus, {
        timeout: 6 * 60_000,
        intervals: [3_000],
      })
      .toBe('ready')
    const result = await callActionAs<any>(request, host.token, 'debugSearch', {
      roomId,
      queries: [
        'Name a food served at Lantern Night. Burnt-honey fudge',
        'Name a food served at Lantern Night. Burnt honey fudge',
        'name a food served at lantern night burnt honey fudge',
        'Burnt-honey fudge',
        'burnt honey fudge',
        'Name a fish sold at the Saltmere fish market. salmon',
        "Name a boat that works or is moored in Saltmere harbor. Tamsin's Luck",
        'Name a food served at Lantern Night. sea-buckthorn jelly',
      ],
    })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await callActionAs(request, host.token, 'endRoom', { roomId })
  }
})
