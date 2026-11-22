/**
 * Seconds left until `endsAt` (a server timestamp in ms), updated 4× a second.
 *
 * Display only. The server stores the real deadline (rooms.questionEndsAt)
 * and refuses late answers; this just counts down to it on the device's
 * clock. If that clock is off by a few seconds, so is the countdown.
 */

import { useEffect, useState } from 'react'

export function useSecondsLeft(endsAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer) // stop when the component goes away
  }, [])

  if (!endsAt) return 0
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}
