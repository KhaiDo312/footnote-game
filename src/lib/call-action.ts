/**
 * Calls a server action (src/actions/) from the browser.
 *
 * Sends the signed-in user's token so the server knows who is asking.
 * Never throws: network problems come back as { success: false, error }.
 */

import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  try {
    const token = await getAuthToken()
    if (!token) return { success: false, error: 'Please sign in first.' }

    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as ActionResponse<T> | null
    if (!body) return { success: false, error: `Server error (${res.status}).` }
    return body
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}
