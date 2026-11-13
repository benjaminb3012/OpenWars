/**
 * Happiness and discontent.
 *
 * Happiness (0..100) is what the population feels today; discontent (0..100)
 * is the accumulated pressure that leads to a civil war. Discontent rises with
 * taxes, wars, military losses and regime pressure, and decays when the nation
 * is at peace and prosperous. Forts and stability reduce both.
 */

import type { PoliticalModifiers } from "@openwars/shared";
import type { BalanceConfig } from "@openwars/shared";
import { clamp } from "@openwars/shared";

export interface HappinessInput {
  modifiers: PoliticalModifiers;
  balance: BalanceConfig;
  taxRate: number;
  /** Number of active wars. */
  wars: number;
  /** Troops lost since the last tick (decays over time). */
  recentLosses: number;
  /** Owned tiles. */
  tiles: number;
  /** Average fort coverage 0..1 of the territory. */
  fortCoverage: number;
  /** Money per tick, used as a prosperity signal. */
  incomePerTick: number;
  atCivilWarRisk: boolean;
}

export interface HappinessResult {
  happiness: number;
  discontent: number;
}

export function computeHappiness(
  current: { happiness: number; discontent: number },
  input: HappinessInput,
): HappinessResult {
  const { modifiers, balance } = input;
  const taxRatio = input.taxRate / 100;
  const taxPressure = taxRatio * taxRatio * balance.taxDiscontent * modifiers.discontentMultiplier;
  // Authoritarian regimes generate structural pressure even without taxes.
  const regimePressure = Math.max(0, -modifiers.happinessBias) * 0.0008;
  // Large empires are harder to govern than small ones.
  const sizePressure = Math.min(0.012, Math.max(0, input.tiles) * 0.000004);
  const warPressure = input.wars > 0 ? balance.warDiscontent * modifiers.discontentMultiplier : 0;
  const lossPressure =
    input.recentLosses > 0
      ? Math.min(0.35, input.recentLosses / Math.max(60, input.tiles * 4)) *
        0.5 *
        modifiers.discontentMultiplier
      : 0;
  const fortRelief = input.fortCoverage * 0.06;
  const prosperity = input.incomePerTick > 0 ? Math.min(0.05, input.incomePerTick / 400) : 0;

  let discontent =
    current.discontent +
    balance.baseDiscontent +
    regimePressure +
    sizePressure +
    taxPressure +
    warPressure +
    lossPressure -
    fortRelief -
    prosperity;
  if (input.wars === 0 && input.recentLosses <= 0 && discontent < 92) {
    discontent -= balance.discontentDecay;
  }
  discontent = clamp(discontent, 0, 100);

  // Happiness chases a target driven by the regime bias and the discontent.
  const target = clamp(
    balance.baseHappiness + modifiers.happinessBias - discontent * 0.7 + fortRelief * 200,
    0,
    100,
  );
  let happiness = current.happiness;
  if (happiness < target) {
    happiness += Math.min(target - happiness, balance.happinessRegen);
  } else {
    happiness -= Math.min(happiness - target, balance.happinessDecay);
  }
  happiness = clamp(happiness, 0, 100);
  return { happiness, discontent };
}

/** True when a secession should be attempted this tick. */
export function civilWarPossible(input: {
  discontent: number;
  cooldown: number;
  tiles: number;
}): boolean {
  return input.discontent >= 100 && input.cooldown <= 0 && input.tiles > 14;
}
