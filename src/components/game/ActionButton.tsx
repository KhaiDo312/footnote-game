/**
 * A button that calls a host action for a room and shows any error.
 * The room itself updates live through useQuery, so there's nothing to do
 * with the result except show an error.
 */

import { useState } from 'react'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'

export type HostAction = 'retryPrepare' | 'retryIndex' | 'nextQuestion' | 'revealQuestion' | 'endRoom'

export function ActionButton(props: {
  action: HostAction
  roomId: string
  label: string
  variant?: 'secondary'
  disabled?: boolean
  testId?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    const result = await callAction(props.action, { roomId: props.roomId })
    if (!result.success) setError(result.error)
    setBusy(false)
  }

  return (
    <div className="mt-6">
      <Button variant={props.variant} disabled={busy || props.disabled} onClick={run} data-testid={props.testId}>
        {busy ? 'Working…' : props.label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
