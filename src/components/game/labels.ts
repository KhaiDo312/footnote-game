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
  rejected: 'The document doesn’t support it', // e.g. it says "no longer taught"
  unchecked: 'Couldn’t check',
}
