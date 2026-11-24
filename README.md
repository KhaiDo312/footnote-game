# Footnote

Footnote is a multiplayer trivia game built from a document. The host uploads a text, AI writes questions about it, and players answer from their phones. Rare answers score more: a common answer is body text, a rarer one sinks to the margin or a footnote, and a true answer nobody else found goes to a deep footnote †.

Live at https://footnote-game.app.space. 

## Prerequisite

A DeepSpace account, Node 22.15+ (or 24 / 26) and npm 11.6+. Auth, records, real-time sync, background jobs, the knowledge index, AI and hosting all come from the SDK (`deepspace@0.44.2`), so there are no API keys to set. AI calls are billed to the app owner's DeepSpace account.

## Quick start

```sh
npm install
npx deepspace auth login   # one-time, opens a browser tab
npx deepspace deploy       # deploys to footnote-game.app.space
```

`deepspace deploy` needs a clean worktree: commit first. Run it locally instead with `npx deepspace dev start`. Local dev works because `vite.config.ts` sets `remoteBindings: false` (see NOTES, SDK feedback #2); knowledge calls still go through the platform and may cost credits.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server (`deepspace dev start`) |
| `npm run deploy` | Deploy to `footnote-game.app.space` |
| `npm test` | Smoke + API + E2E specs on a local server (`deepspace test run`) |
| `npm run test:unit` | Vitest unit tests (scoring, judge, answer checks, join codes) |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npx deepspace logs --since <ISO> --limit 500` | Server logs. The default 100 events often hides job and `[judge]` lines |
| `npx deepspace app usage` | Credits and AI spend |

Formatting: there is no Prettier config, and the house style is single quotes, no semicolons, 120 columns. Never run plain `prettier --write`; use `npx prettier --write --no-semi --single-quote --print-width 120 <file>`.

## Features

- **Rooms from a document:** upload a text; a background job writes questions with AI and checks every listed answer really appears in the text. The lobby opens in ~13 s; Start waits for the search index (~2 min), and players can join meanwhile.
- **Join by code or link:** 5-letter codes and `/join/<code>`.
- **Live questions:** 30-second server-side deadline, shown as an ink line that drains; one answer per player.
- **Rarity scoring:** fewer players with the same answer → more points.
- **AI judge for answers not on the list:** the AI must quote the document, and the server checks the quote is real and contains the answer. Strict on purpose; see NOTES.
- **Final scores:** a top-3 leaderboard that scrolls, and a paper note with one ink line per player (deeper = higher score, yours in red).
- **Paper-and-ink design,** mobile-first at 375 px; animations off under `prefers-reduced-motion`.

## How it works

A DeepSpace app on Cloudflare Workers. Game state lives in record collections (`src/schemas/game-schemas.ts`) that sync to every browser through `useQuery`; the answer lists (`roomSecrets`) and saved verdicts (`verdicts`) are server-only. Every change goes through a server action in `src/actions/` that checks the caller itself. Two background jobs (`prepare-room`, `watch-index`) write the questions and wait for the knowledge index. All tunables (AI model, timings, limits) are in `src/game/config.ts`.

## Tests

```sh
npm run test:unit
npx deepspace test run all
```

The signed-in specs use two test accounts, "Footnote Player A" and "Footnote Player B". Their passwords live only in `~/.deepspace/test-accounts.json`:

```sh
npx deepspace test accounts create   # once per account
```

**Against the live app.** `game-flow.spec.ts` (a full game with concurrent clicks, ~2 min) and `browser-game.spec.ts` (a whole game in two 375 px browsers, ~2–4 min, saves screenshots to `test-results/`) run against https://footnote-game.app.space. Both **cost credits**, so run them on purpose. Use a local Playwright config, which git ignores:

```js
// .deepspace/live.config.mjs
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '<absolute path to>/tests',
  testMatch: ['api.spec.ts', 'game-flow.spec.ts', 'browser-game.spec.ts'],
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'https://footnote-game.app.space' },
})
```

```sh
npx playwright test -c .deepspace/live.config.mjs
```

**Chromium on WSL without sudo.** If Chromium fails with `libnspr4.so` missing, unpack the libraries instead of installing them system-wide: `apt-get download libnspr4 libnss3 libasound2t64`, `dpkg-deb -x` each into `~/.local/chromium-libs/x`, then run tests with `LD_LIBRARY_PATH=$HOME/.local/chromium-libs/x/usr/lib/x86_64-linux-gnu`. (With sudo: `sudo npx playwright install-deps chromium`.)

---

Built with the [DeepSpace SDK](https://docs.deep.space).
