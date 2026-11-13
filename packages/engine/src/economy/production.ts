/**
 * Pure production formulas.
 *
 * Keeping them out of `GameImpl` makes the economy testable in isolation and
 * makes balancing a matter of changing `BalanceConfig` values only.
 */

import {
  BUILDINGS,
  type BalanceConfig,
  type PoliticalModifiers,
} from "@openwars/shared";
import { happinessIncomeFactor, taxFactor } from "../politics/governments";

/** Cities stack linearly: +2 % of industrial production per city by default. */
export function cityProductionBonus(cities: number, perCity: number): number {
  return 1 + Math.max(0, cities) * perCity;
}

/** Maximum population a territory can hold. */
export function maxPopulationOf(
  tiles: number,
  cityLevels: number,
  modifiers: PoliticalModifiers,
  balance: BalanceConfig,
): number {
  const base = balance.popBase + tiles * balance.popPerTile + cityLevels * balance.popPerCity;
  return Math.max(160, base * modifiers.populationGrowthMultiplier);
}

export interface IncomeInput {
  tiles: number;
  population: number;
  /** Number of cities (level 1 or more). */
  cities: number;
  /** Sum of factory levels attached to a valid network. */
  factoryLevels: number;
  ports: number;
  airports: number;
  upkeep: number;
  taxRate: number;
  happiness: number;
  modifiers: PoliticalModifiers;
  balance: BalanceConfig;
}

export interface IncomeBreakdown {
  flat: number;
  tiles: number;
  citizens: number;
  industrial: number;
  ports: number;
  airports: number;
  upkeep: number;
  net: number;
}

export function incomeBreakdown(input: IncomeInput): IncomeBreakdown {
  const { modifiers, balance } = input;
  const tax = taxFactor(input.taxRate, modifiers);
  const happinessFactor = happinessIncomeFactor(input.happiness);
  const cities = cityProductionBonus(input.cities, balance.cityProductionBonus);

  const flat = balance.incomeBase * modifiers.economicMultiplier;
  const tiles = input.tiles * balance.incomePerTile * modifiers.economicMultiplier * tax * happinessFactor;
  const citizens =
    input.population * balance.incomePerCitizen * modifiers.economicMultiplier * tax * happinessFactor;
  const industrial =
    input.factoryLevels *
    BUILDINGS.factory.effectPerLevel *
    modifiers.productionMultiplier *
    cities *
    happinessFactor;
  const ports = input.ports * BUILDINGS.port.effectPerLevel * 0.4 * modifiers.economicMultiplier * cities;
  const airports = input.airports * 0.3 * modifiers.economicMultiplier;
  const upkeep = input.upkeep * balance.upkeepFactor;
  return {
    flat,
    tiles,
    citizens,
    industrial,
    ports,
    airports,
    upkeep,
    net: flat + tiles + citizens + industrial + ports + airports - upkeep,
  };
}
