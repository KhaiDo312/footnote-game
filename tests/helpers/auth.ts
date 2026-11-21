/**
 * Sign a @deepspace.test account in over plain HTTP and get its JWT,
 * without a browser. Credentials come from ~/.deepspace/test-accounts.json
 * (created with `npx deepspace test accounts create`), never from this repo.
 */

import type { APIRequestContext } from '@playwright/test'
import { findTestAccountByName } from 'deepspace/testing'

export async function signInAndGetToken(
  request: APIRequestContext,
  baseURL: string,
  accountName: string,
): Promise<{ token: string; userId: string }> {
  const account = findTestAccountByName(accountName)
  if (!account) {
    throw new Error(`No test account named "${accountName}". Create it with: npx deepspace test accounts create`)
  }

  // Better Auth refuses sign-in without an Origin header (CSRF protection),
  // so send the app's own origin, as a browser on this page would.
  // It sets a session cookie on `request`; the token route then reads it.
  const signIn = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: new URL(baseURL).origin },
    data: { email: account.email, password: account.password },
  })
  if (!signIn.ok()) {
    throw new Error(`Sign-in failed for ${account.email}: ${signIn.status()} ${await signIn.text()}`)
  }

  const tokenRes = await request.post('/api/auth/token', {
    headers: { Origin: new URL(baseURL).origin },
    data: {},
  })
  const { token } = (await tokenRes.json()) as { token?: string }
  if (!token) throw new Error(`No token for ${account.email}`)

  // Node decodes base64url as UTF-8 correctly (unlike the SDK's browser atob; see NOTES.md).
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  return { token, userId: String(payload.sub) }
}

/** The app's record/job scope id, read from wrangler.toml like the build does. */
export async function appScopeId(): Promise<string> {
  const { readFileSync } = await import('node:fs')
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8')
  const match = toml.match(/^DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error('DEEPSPACE_APP_ID not found in wrangler.toml')
  return `app:${match[1]}`
}
