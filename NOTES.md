# Footnote — notes

Honest notes for reviewers: SDK issues we hit, and a daily log of what was
built and what was checked. The plan is in [PLAN.md](PLAN.md).

Live app: https://footnote-game.app.space · SDK: `deepspace@0.44.2`

---

## SDK feedback

### 1. Non-ASCII display names are garbled in the browser (bug)

**Symptom.** A Google account named "Khải Đỗ" shows as "Kháº£i Äá»" followed
by an invisible character, in the nav bar, on `/home` and on `/settings`. Any
name with characters outside ASCII is affected (Vietnamese, accented Latin,
CJK, emoji).

**Where.** `node_modules/deepspace/dist/index.js:1539`, in `RecordProvider`'s
`fetchUser` (SDK source `src/client/storage/context.tsx`):

```js
const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
return { id: payload.sub, name: payload.name ?? "", ... }
```

**What's wrong.** `atob()` returns a "binary string" with one character per
byte. The JWT payload is UTF-8 JSON, so each multi-byte character becomes
several Latin-1 characters. The garbled `name` reaches the app through
`useUser()` and `useAuthProfileReady()`.

**One-line fix.** Decode the bytes as UTF-8:

```js
const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
```

The SDK's own server-side `decodeJwtPayload` (`dist/worker.js:6286-6297`)
already does this correctly with `TextDecoder`, so the browser decoder just
needs to match it.

**Reproduced** in Node with a payload of `{"name":"Khải Đỗ"}`. The `atob` path
prints `Kháº£i Äá»…`, and the `TextDecoder` path prints `Khải Đỗ`.

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
- Asked whether Day 1 covered the deploy (yes) and the "only the server can
  start jobs" setting.

**Not done / open**
- The "only the server can start jobs" setting (`authorizeWrite: () => false`
  on `AppJobRoom`) is **not set or tested yet**. It is a Day 2 task. Until
  then, the scaffold default lets any member enqueue jobs. That's harmless
  today, because no job types exist.
- 7 of 8 browser tests can't run on this WSL machine because system
  libraries are missing (`libnspr4.so`). Fix (needs sudo):
  `sudo npx playwright install-deps chromium`.
- We haven't checked that the new collections load on the live app. The
  first room created on Day 2 will show it.
