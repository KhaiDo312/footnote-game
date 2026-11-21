# Footnote — notes

Notes for reviewers: SDK issues we hit, and a daily log of what was
built and what was checked. The plan is in [PLAN.md](PLAN.md).

Live app: https://footnote-game.app.space · SDK: `deepspace@0.44.2`

---

## SDK feedback

### 1. Non-ASCII display names are garbled in the browser (bug)

**Symptom.** A Google account named "Khải Đỗ" shows as "Kháº£i Äá»" followed by an invisible character, in the nav bar, on `/home` and on `/settings`. Any name with characters outside ASCII is affected (Vietnamese, accented Latin,
CJK, emoji).

**Where.** `node_modules/deepspace/dist/index.js:1539`, in `RecordProvider`'s
`fetchUser` (SDK source `src/client/storage/context.tsx`):

```js
const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
return { id: payload.sub, name: payload.name ?? "", ... }
```

**What's wrong.** `atob()` returns a "binary string" with one character per byte. The JWT payload is UTF-8 JSON, so each multi-byte character becomes several Latin-1 characters. The garbled `name` reaches the app through `useUser()` and `useAuthProfileReady()`.

**One-line fix.** Decode the bytes as UTF-8:
```js
const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
```

The SDK's own server-side `decodeJwtPayload` (`dist/worker.js:6286-6297`) already does this correctly with `TextDecoder`, so the browser decoder just needs to match it.

**Reproduced** in Node with a payload of `{"name":"Khải Đỗ"}`. The `atob` path prints `Kháº£i Äá»…`, and the `TextDecoder` path prints `Khải Đỗ`.

**Scope.**
- `dist/index.js:845` (`extractExpiry`) uses the same `atob` pattern, but it
  only reads `exp`, a number, so it is harmless there.
- Names that come from the server (the `users` roster from `useUsers()`, and
  names our server actions copy into `players`) are decoded correctly.

**What we did.** Nothing yet. We did not patch `node_modules`. Workaround if
needed: show names from `useUsers()` or `players` instead of
`useAuthProfileReady().user.name`.

### 2. The suggested knowledge binding breaks local dev (friction)

The scaffold's `wrangler.toml` comment suggests adding
`[[ai_search]] binding = "KNOWLEDGE", instance_name = "auto"`. After adding it,
`deepspace dev start` and `deepspace test run` both fail with *"Failed to
start the remote proxy session … set a CLOUDFLARE_API_TOKEN"*, because
Cloudflare's Vite plugin treats AI Search as a remote binding. The SDK never
reads `env.KNOWLEDGE` (`knowledge(env)` uses the platform transport), so we set
`remoteBindings: false` in `vite.config.ts`. That fixed startup. The
knowledge docs page doesn't mention this; a note there, or a scaffold default,
would save the next person the debugging.

**Update (Day 2):** with `remoteBindings: false`, `knowledge(env)` add, list
and search all work in local dev. They go through the platform, and the dev
server warns that this "may incur usage charges even in local dev".

### 3. Indexing takes ~100 seconds even for tiny documents (docs gap)

Measured on the live app (Nov 21) from `kb.add` until `kb.list` reported
`completed`: **96 s** for a 0.6 KB text file, **97 s** for a 3 KB one, and
**over 120 s** in one other 3 KB run. The knowledge page says to poll `list`
before searching, but gives no idea of how long that takes. We first planned a
2-minute cutoff, and it failed real documents. A rough latency figure in the
docs would help anyone designing a "wait for indexing" step.

### 4. Smaller things we tripped over

- **Sort direction.** `useQuery(..., { orderBy: 'index' })` sorts
  **descending** unless you also pass `orderDir: 'asc'`. Found by reading
  `executeTableQuery`; the records reference doesn't say so.
- **Job queue messages.** `job.update` carries both the initial snapshot
  (`kind: 'snapshot'`) and real enqueues (`kind: 'enqueued'`). A test that
  only checks the type sees a false "job enqueued".
- **Test accounts sign in over HTTP only with an `Origin` header.** Better Auth
  returns `403 MISSING_OR_NULL_ORIGIN` without one. Worth a line in the
  testing guide for browser-free API tests.
- **Default job permissions.** A test account that has never opened the app
  has no role yet, so the scaffold's default job rule refuses it *for that
  reason*. A "players can't start jobs" test that skips connecting to the app
  first passes even when the hole is open. Our test connects first, and we
  watched it fail before the fix and pass after.
- **Possible security concern we checked (not an issue).** The job room
  accepts `POST …/enqueue` with no permission check, and the scaffold's
  `/ws/jobs/:roomId` route forwards requests to the job room unchanged. It's
  safe only because that route is registered as GET-only. We confirmed this on
  the live app: a POST returns 404. Anyone who changes the route to `app.all`
  would open it up; a comment in the scaffold would help.
- **`deepspace logs --search`** found nothing for text that `--since <time>`
  plainly showed. We may be misusing it; we used time windows instead.

---

## Agent log

### Sat Nov 21 — Day 1

**What the agent (Claude Code) did**
- Read the DeepSpace docs (knowledge, server actions, permissions, realtime
  sync, background jobs, the AI reference) and the installed SDK types, then
  wrote PLAN.md. After your answers it updated the plan: Haiku for all AI
  calls, set in one file; 5-letter join codes; a 2-minute indexing cutoff
  with an `error` state and Retry; the off-list AI check as the last thing
  to cut.
- Added `src/game/config.ts` (the `AI_MODEL` setting and every tunable value),
  `src/game/join-code.ts` with unit tests, the 5 game collections in
  `src/schemas/game-schemas.ts`, the knowledge binding, and landing page
  and SEO text.
- Registered the app (`app_01M7Z746NHCKQNE9HQGT5Z9AMF`, owner
  dokhai219@gmail.com), after you confirmed the account.
- Found and worked around the knowledge binding / local dev problem (SDK
  feedback #2).
- Commit `50b0574`, deployed to footnote-game.app.space. Commit `bbe7611`
  only updated PLAN.md (not deployed; docs only).
- Traced the garbled name you reported to the SDK line above, and
  reproduced it in Node. No code changed.

**Checks the agent ran**
- `tsc --noEmit`, ESLint, and `vitest` (9 tests): all pass.
- SDK schema linter (`lintSchemas`) on all collections: no warnings.
- `curl` against the live site: the landing page shows the new title, and
  `/api/auth/ok` and `/home` return 200.
- `deepspace logs`: no events in the last 15 minutes (no errors, but also no
  traffic yet).

**What you checked**
- Opened the live app, signed in with Google (cacahoangkhai@gmail.com, a
  `member`, not the owner), and checked `/home` and `/settings`.
- Spotted the garbled display name and correctly suspected `atob()` without
  `TextDecoder`.
- Confirmed if whether the intended plan have been implemented well.
- Look into the implementation and confirm the overall structure.

**Not done / open**
- 7 of 8 browser tests can't run on this WSL machine because system
  libraries are missing (`libnspr4.so`).
- We haven't checked that the new collections load on the live app. The
  first room created on Day 2 will show it. *(Done on Day 2: rooms,
  questions and roomSecrets all work live.)*

### Sat Nov 21 — Day 2 (started early)

**What the agent did**
- Listed the Day 2 files and the job-permission test plan before coding.
- Created two test accounts after you approved them ("Footnote Player A"
  and "Footnote Player B"). Passwords are only in
  `~/.deepspace/test-accounts.json`.
- **Job lock:** `AppJobRoom` now uses `authorizeWrite: () => false`. Wrote
  the test first and watched it fail against the old rule (a real `member`
  *could* enqueue `prepare-room`), then pass after the change.
- Built `createRoom`, `retryPrepare`, `endRoom`, and the `prepare-room` job
  (wait for indexing, AI questions, fulltext verification, lobby). Also the
  helpers (`normalize.ts`, `verify.ts`, `knowledge.ts`, `ai.ts`,
  `prompts.ts`) and the pages `/new`, `/room/:id` and `/home`.
- `endRoom` was **not in the original plan**. It was added so abandoned rooms
  (and test rooms) stop counting toward the 3-active-rooms cap. PLAN.md §2
  is updated.
- **Changed the indexing cutoff from 2 to 5 minutes**, with your OK, after
  measuring live indexing (SDK feedback #3).
- Commits `d1581ee` (Day 2) and the cutoff change, both deployed.

**Checks the agent ran**
- Unit tests: 25 pass (join codes, normalization, answer verification
  with a fake search).
- Local (`deepspace test run`): all 4 new API tests pass, including the job
  lock. The real document reached `lobby` and the nonsense document ended
  `failed`.
- **Live app:** the job lock and the action checks pass. Real document →
  `lobby` (after the 5-minute change; with 2 minutes it correctly went to
  `error` with the Retry message). Nonsense → `failed` ("AI took 2s,
  usable=false"). Permissions held: an outsider can't read the room or its
  hidden questions, and **nobody, not even the host**, can read `roomSecrets`
  from the browser.
- `deepspace app usage`: anthropic, 6 calls, **$0.0069** total so far.

**Not checked**
- **The pages were not opened in a browser.** Chromium still can't start on
  this WSL machine. They type-check, lint and build, but their look and
  behaviour are unverified. To check them: sign in, go to /home → Host a new
  game, upload `tests/fixtures/harbor-market.md`, and watch the room go
  preparing → lobby. You should see a 5-letter code and the question list.
- Retry from a real `error` state was not exercised end-to-end. It was only
  checked as "refuses non-hosts". The 5-minute timeout path ran once live,
  with the old 2-minute value, and showed the right message.
- For the passing live run, the job's "AI took / verified N answers" log lines
  never showed up in `deepspace logs`, so we have no live figure for how many
  AI answers verification threw away.
