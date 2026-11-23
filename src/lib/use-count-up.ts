/**
 * Counts from 0 up to `to`, starting after `delayMs`, for the reveal's points.
 * Display only. With prefers-reduced-motion it shows `to` straight away.
 */

import { useEffect, useState } from 'react'

const DURATION_MS = 600

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useCountUp(to: number, delayMs = 0): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : 0))

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(to)
      return
    }
    let frame = 0
    const start = performance.now() + delayMs
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / DURATION_MS))
      setValue(Math.round(to * (1 - (1 - t) ** 3))) // ease-out: fast, then settles
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, delayMs])

  return value
}
