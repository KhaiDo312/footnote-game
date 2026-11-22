/** Words shown to players for tiers and verdicts. */

import type { AnswerTier, Verdict } from '@/schemas/game-schemas'

export const TIER_LABEL: Record<AnswerTier, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  niche: 'Niche',
  none: 'Not on the list',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  listed: 'On the list',
  supported: 'Found in the document',
  rejected: 'Not in the document',
  unchecked: 'Couldn’t check',
}

export const VERDICT_BADGE: Record<Verdict, 'success' | 'info' | 'destructive' | 'secondary'> = {
  listed: 'success',
  supported: 'info',
  rejected: 'destructive',
  unchecked: 'secondary',
}
