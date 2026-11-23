/**
 * One question played in two real browsers at phone width (375 px): the host
 * ("Footnote Player A") and a player ("Footnote Player B"). Checks the pages
 * render, nothing scrolls sideways, reduced motion turns the animations off,
 * and saves screenshots of each screen to test-results/.
 *
 * COSTS CREDITS (one AI call to write questions, maybe one to judge) and
 * takes ~3 minutes, mostly waiting for the search index. Run it on purpose.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { signInAndGetToken } from './helpers/auth'
import { callActionAs, readAs } from './helpers/records'

test.describe.configure({ timeout: 8 * 60_000 })

const PHONE = { width: 375, height: 812 }
const fixture = readFileSync(new URL('./fixtures/saltmere-almanac.md', import.meta.url), 'utf8')

test('one question in two phone-sized browsers', async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext({ viewport: PHONE, baseURL })
  const playerContext = await browser.newContext({ viewport: PHONE, baseURL })
  // Signing in through the context's request sets the session cookie its pages use.
  const host = await signInAndGetToken(hostContext.request, baseURL!, 'Footnote Player A')
  await signInAndGetToken(playerContext.request, baseURL!, 'Footnote Player B')
  const hostPage = await hostContext.newPage()
  const playerPage = await playerContext.newPage()

  const shot = (page: Page, name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
  const noSideScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal scroll').toBeLessThanOrEqual(
      PHONE.width,
    )

  const created = await callActionAs<any>(hostContext.request, host.token, 'createRoom', {
    title: `__test-${Date.now()}__ Saltmere`,
    text: fixture,
  })
  expect(created, JSON.stringify(created)).toMatchObject({ success: true })
  const { roomId, joinCode } = created.data

  try {
    await hostPage.goto(`/room/${roomId}`)
    await expect(hostPage.getByTestId('room-lobby')).toBeVisible({ timeout: 2 * 60_000 })

    // The player joins by link and lands in the lobby; the host sees the name ink in.
    await playerPage.goto(`/join/${joinCode}`)
    await expect(playerPage.getByTestId('player-lobby')).toBeVisible({ timeout: 30_000 })
    await expect(hostPage.getByTestId('player-list')).toContainText('Footnote Player B')
    await shot(hostPage, '1-host-lobby')
    await shot(playerPage, '1-player-lobby')
    await noSideScroll(hostPage)
    await noSideScroll(playerPage)

    // Start once the answer checker is ready.
    await expect
      .poll(async () => (await readAs<any>(baseURL!, host.token, 'rooms', { recordId: roomId }))[0]?.data.indexStatus, {
        timeout: 6 * 60_000,
        intervals: [3_000],
      })
      .toBe('ready')
    await hostPage.getByTestId('start').click()
    await expect(playerPage.getByTestId('question-view')).toBeVisible()
    await playerPage.waitForTimeout(2_500) // let the ink line drain a little
    await shot(playerPage, '2-player-question')
    await noSideScroll(playerPage)

    await playerPage.getByTestId('answer-input').fill('herring')
    await playerPage.getByRole('button', { name: 'Lock in' }).click()
    await expect(playerPage.getByTestId('answer-locked')).toBeVisible()
    await shot(playerPage, '3-player-locked')

    await hostPage.getByTestId('reveal').click()
    await expect(playerPage.getByTestId('results')).toBeVisible({ timeout: 30_000 })
    await playerPage.waitForTimeout(3_000) // drops and count-up finish
    await expect(playerPage.getByTestId('my-points')).toBeVisible()
    await shot(playerPage, '4-player-reveal')
    await shot(hostPage, '4-host-reveal')
    await noSideScroll(playerPage)

    // Reduced motion: the drop animation is switched off.
    await playerPage.emulateMedia({ reducedMotion: 'reduce' })
    const animation = await playerPage
      .locator('[data-testid="results"] li')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)
    expect(animation).toBe('none')
  } finally {
    await callActionAs(hostContext.request, host.token, 'endRoom', { roomId })
    await hostContext.close()
    await playerContext.close()
  }
})
