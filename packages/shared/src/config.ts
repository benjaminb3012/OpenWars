/**
 * Single source of truth for balance values.
 * The engine reads this object at construction time (a game can override it),
 * so balancing never requires touching the simulation code.
 */

export interface BalanceConfig {
  /** Simulation ticks per second. */
  tickRate: number;

  // --- Economy -------------------------------------------------------------
  startMoney: number;
  startTroops: number;
  startPopulation: number;
  /** Flat income per tick, so small nations can still develop. */
  incomeBase: number;
  /** Money per owned tile per tick. */
  incomePerTile: number;
  /** Money per inhabitant per tick (scaled by tax rate). */
  incomePerCitizen: number;
  /** Share of the gross income taken by infrastructure upkeep. */
  upkeepFactor: number;
  /** Factor applied to the city production bonus per city. */
  cityProductionBonus: number;
  /** Max population from territory. */
  popPerTile: number;
  popBase: number;
  popPerCity: number;
  /** Population growth per tick, as a fraction of the missing population. */
  popGrowth: number;
  /** Troops capacity per inhabitant. */
  troopsPerCitizen: number;
  /** Troop regeneration per tick as a fraction of max troops. */
  troopRegen: number;
  /** Maximum share of troops a single attack can commit. */
  maxAttackCommitment: number;

  // --- Territory -----------------------------------------------------------
  /** Tiles colonised per tick by a one-tile nation. */
  colonizeBaseRate: number;
  /** Extra tiles per tick per owned tile. */
  colonizeRatePerTile: number;
  colonizeMaxPerTick: number;
  /** Money cost of colonising one unclaimed tile. */
  colonizeCost: number;
  /** Troop cost of capturing one enemy tile (before fort bonuses). */
  attackCostPerTile: number;
  /** Troop damage dealt to the defender per captured tile. */
  attackDefenderLossPerTile: number;
  /** Hard cap of tiles captured by a single attack. */
  maxTilesPerAttack: number;
  /** Search radius (in tiles) used to find the frontier closest to a click. */
  attackFrontierRadius: number;
  /** Share of a nation's troops lost when a tile is conquered. */
  conquestTroopLoss: number;

  // --- Politics ------------------------------------------------------------
  baseHappiness: number;
  /** Discontent gained per tick by the regime itself (pressure). */
  baseDiscontent: number;
  /** Discontent gained per tick with a tax rate of 100 % (squared scaling). */
  taxDiscontent: number;
  /** Discontent per tick when at war. */
  warDiscontent: number;
  /** Discontent decay per tick when everything is fine. */
  discontentDecay: number;
  /** Happiness gained per tick when discontent is 0. */
  happinessRegen: number;
  /** Happiness lost per tick when discontent is high. */
  happinessDecay: number;
  /** Ticks before the same nation can erupt in civil war again. */
  civilWarCooldownTicks: number;
  /** Ticks a nation cannot be attacked after joining. */
  spawnProtectionTicks: number;
  /** Delay before the AI nations spawn, so humans pick their spawn first. */
  spawnGraceTicks: number;
  /** Ticks between two government changes. */
  governmentChangeCooldownTicks: number;
  /** Share of the territory that can secede. */
  civilWarMaxTerritoryShare: number;

  // --- Military ------------------------------------------------------------
  boatCost: number;
  boatSpeed: number;
  boatHp: number;
  warshipCost: number;
  warshipSpeed: number;
  warshipHp: number;
  /** Troop cost per beachhead tile. */
  landingCostPerTile: number;
  /** Money per trade ship delivery. */
  tradeShipValue: number;
  tradeShipSpeed: number;
  planeSpeed: number;
  planeTradeValue: number;
  /** Radius in which SAM sites can intercept a missile. */
  samRadiusBase: number;
  samRadiusPerLevel: number;
  samCooldownTicks: number;

  // --- Network / simulation ------------------------------------------------
  /** How often (in ticks) the transport network is recomputed. */
  networkRecomputeTicks: number;
  /** How often (in ticks) the economy is settled. */
  economyTicks: number;
  /** Maximum number of world events kept in memory. */
  eventHistorySize: number;
  /** Ticks a scorch mark stays on the map. */
  scorchTicks: number;
  /** Bot decision interval in ticks. */
  botThinkTicks: number;
}

export const DEFAULT_BALANCE: BalanceConfig = {
  tickRate: 10,

  startMoney: 640,
  startTroops: 150,
  startPopulation: 500,
  incomeBase: 0.5,
  incomePerTile: 0.006,
  incomePerCitizen: 0.0003,
  upkeepFactor: 1,
  cityProductionBonus: 0.02,
  popPerTile: 9,
  popBase: 420,
  popPerCity: 120,
  popGrowth: 0.0045,
  troopsPerCitizen: 0.4,
  troopRegen: 0.0009,
  maxAttackCommitment: 0.7,

  colonizeBaseRate: 0.15,
  colonizeRatePerTile: 0.0008,
  colonizeMaxPerTick: 0.5,
  colonizeCost: 0.8,
  attackCostPerTile: 2.2,
  attackDefenderLossPerTile: 1.1,
  maxTilesPerAttack: 240,
  attackFrontierRadius: 14,
  conquestTroopLoss: 0.12,

  baseHappiness: 62,
  baseDiscontent: 0.004,
  taxDiscontent: 0.055,
  warDiscontent: 0.025,
  discontentDecay: 0.006,
  happinessRegen: 0.35,
  happinessDecay: 0.2,
  civilWarCooldownTicks: 900,
  civilWarMaxTerritoryShare: 0.45,
  spawnProtectionTicks: 150,
  spawnGraceTicks: 260,
  governmentChangeCooldownTicks: 900,

  boatCost: 120,
  boatSpeed: 0.09,
  boatHp: 100,
  warshipCost: 320,
  warshipSpeed: 0.13,
  warshipHp: 160,
  landingCostPerTile: 2.6,
  tradeShipValue: 26,
  tradeShipSpeed: 0.05,
  planeSpeed: 0.16,
  planeTradeValue: 34,
  samRadiusBase: 7,
  samRadiusPerLevel: 1.5,
  samCooldownTicks: 40,

  networkRecomputeTicks: 20,
  economyTicks: 1,
  eventHistorySize: 220,
  scorchTicks: 600,
  botThinkTicks: 25,
};
