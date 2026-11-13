/** Government resolution: single place where regime modifiers are applied. */

import {
  GOVERNMENTS,
  type GovernmentSpec,
  type GovernmentType,
  type PoliticalModifiers,
} from "@openwars/shared";

export function governmentOf(type: GovernmentType): GovernmentSpec {
  return GOVERNMENTS[type] ?? GOVERNMENTS.democracy;
}

export function modifiersOf(type: GovernmentType): PoliticalModifiers {
  return governmentOf(type).modifiers;
}

/**
 * Effective tax pressure: the regime's `taxRate` is the *floor*, the player can
 * raise taxes on top of it. Returns a factor around 0.6 .. 1.6.
 */
export function taxFactor(taxRate: number, modifiers: PoliticalModifiers): number {
  const combined = taxRate;
  return 0.5 + combined / 100;
}

/** Income multiplier from happiness: unhappy populations stop paying taxes. */
export function happinessIncomeFactor(happiness: number): number {
  if (happiness >= 70) return 1.1;
  if (happiness >= 45) return 1;
  if (happiness >= 25) return 0.85;
  return 0.65;
}

/** Production (construction + colonisation) slowed down by discontent. */
export function stabilityProductionFactor(discontent: number): number {
  if (discontent <= 30) return 1;
  return Math.max(0.55, 1 - (discontent - 30) / 140);
}

/** Troop regeneration is faster under a stable, happy regime. */
export function moraleTroopFactor(happiness: number): number {
  return 0.7 + Math.min(100, Math.max(0, happiness)) / 220;
}
