/**
 * Test helpers that talk to the app the way a browser does, without a browser:
 * read records over the records WebSocket (so permission rules apply exactly
 * as they do for a real user), and call server actions over HTTP.
 */

import type { APIRequestContext } from '@playwright/test'
import { appScopeId } from './auth'

export type Envelope<T> = { recordId: string; data: T; createdBy: string }

/** Reads `collection` as the signed-in user: only what their permissions allow. */
export async function readAs<T = Record<string, unknown>>(
  baseURL: string,
  token: string,
  collection: string,
  where: Record<string, unknown> = {},
): Promise<Envelope<T>[]> {
  const url = `${baseURL.replace(/^http/, 'ws')}/ws/${encodeURIComponent(await appScopeId())}?token=${token}`
  const socket = new WebSocket(url)
  try {
    return await new Promise<Envelope<T>[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No query result for ${collection}`)), 10_000)
      socket.addEventListener('error', () => reject(new Error('Records WebSocket failed')))
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'q1', query: { collection, where } } }),
        )
      })
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data))
        if (message.type === 'core.query_result' && message.payload?.subscriptionId === 'q1') {
          clearTimeout(timer)
          resolve(message.payload.records as Envelope<T>[])
        }
      })
    })
  } finally {
    socket.close()
  }
}

/** Calls POST /api/actions/<name> as the signed-in user. */
export async function callActionAs<T = unknown>(
  request: APIRequestContext,
  token: string,
  name: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await request.post(`/api/actions/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: params,
  })
  return res.json()
}
