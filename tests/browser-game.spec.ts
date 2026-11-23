/**
 * A whole game in two real browsers at phone width (375 px): the host
 * ("Footnote Player A") and a player ("Footnote Player B"). Checks the pages
 * render, nothing scrolls sideways, reduced motion turns the animations off,
 * answers late in the document get a real verdict, and the sign-in box and
 * account menu are readable. Saves screenshots of each screen to test-results/.
 *
 * COSTS CREDITS (one AI call to write questions, maybe one to judge) and
 * takes ~3 minutes, mostly waiting for the search index. Run it on purpose.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { signInAndGetToken } from './helpers/auth'
import { callActionAs, readAs } from './helpers/records'

test.describe.configure({ timeout: 10 * 60_000 })

const PHONE = { width: 375, height: 812 }
const fixture = readFileSync(new URL('./fixtures/saltmere-almanac.md', import.meta.url), 'utf8')

test('one question in two phone-sized browsers', async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext({ viewport: PHONE, baseURL })
  const playerContext = await browser.newContext({ viewport: PHONE, baseURL })
  // Signing in through the context's request sets the session cookie its pages use.
  const host = await signInAndGetToken(hostContext.request, baseURL!, 'Footnote Player A')
  const player = await signInAndGetToken(playerContext.request, baseURL!, 'Footnote Player B')
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
    await playerPage.emulateMedia({ reducedMotion: 'no-preference' })

    // Play the rest. The player answers "Burnt-honey fudge" every time: it is in
    // the document but late in it, where the search index couldn't find it
    // (Nov 23 bug). It must get a real verdict, never "Couldn't check".
    for (;;) {
      await hostPage.getByTestId('next').click()
      if (await hostPage.getByTestId('final-scoreboard').isVisible({ timeout: 5_000 }).catch(() => false)) break
      await expect(playerPage.getByTestId('answer-input')).toBeVisible()
      await playerPage.getByTestId('answer-input').fill('Burnt-honey fudge')
      await playerPage.getByRole('button', { name: 'Lock in' }).click()
      await expect(playerPage.getByTestId('answer-locked')).toBeVisible()
      await hostPage.getByTestId('reveal').click()
      await expect(hostPage.getByTestId('next')).toBeVisible({ timeout: 30_000 })
    }
    const subs = await readAs<{ text: string; verdict: string; points: number }>(baseURL!, player.token, 'submissions', {
      roomId,
    })
    console.log(`[browser] verdicts: ${JSON.stringify(subs.map((s) => [s.data.text, s.data.verdict, s.data.points]))}`)
    expect(subs.filter((s) => s.data.verdict === 'unchecked'), 'every answer got a real verdict').toEqual([])

    await expect(playerPage.getByTestId('depth-note')).toBeVisible()
    await playerPage.waitForTimeout(1_500) // ink lines finish flowing
    await shot(playerPage, '5-player-final')
    await noSideScroll(playerPage)

    // The account menu and the sign-in box are readable (cream on navy, not cream on cream).
    await playerPage.setViewportSize({ width: 1024, height: 700 })
    await playerPage.getByTestId('app-navigation').getByRole('button').first().click()
    await shot(playerPage, '6-account-menu')
    const signedOut = await browser.newContext({ viewport: PHONE, baseURL })
    const outPage = await signedOut.newPage()
    await outPage.goto(`/join/${joinCode}`)
    await expect(outPage.getByText('Sign in to continue')).toBeVisible()
    await shot(outPage, '7-signed-out-join')
    await signedOut.close()
  } finally {
    await callActionAs(hostContext.request, host.token, 'endRoom', { roomId })
    await hostContext.close()
    await playerContext.close()
  }
})
