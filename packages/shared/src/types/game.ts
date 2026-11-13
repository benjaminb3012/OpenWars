/** Top level game state shared between engine, server and client. */

import type { CountryData } from "./country";
import type { BuildingData } from "./buildings";
import type { AllianceData, AllianceRequest, DiplomacyRelation, TransferSettings } from "./diplomacy";
import type { WorldEvent } from "./events";
import type { BoatData, MissileData, PlaneData, TradeShipData } from "./military";
import type { StrategicKind } from "./strategic";

export interface MapInfo {
  width: number;
  height: number;
  seed: number;
  /** Number of land tiles. */
  landTiles: number;
  /** Spawn tile index per player slot. */
  spawns: number[];
}

export interface PlayerState {
  id: number;
  /** Player pseudonym. */
  name: string;
  country: CountryData;
  isBot: boolean;
  alive: boolean;
  money: number;
  population: number;
  maxPopulation: number;
  troops: number;
  maxTroops: number;
  taxRate: number;
  /** Owned land tiles. */
  tiles: number;
  capital: number;
  /** Money earned per tick (net of upkeep). */
  incomePerTick: number;
  /** Ability unlocks derived from buildings. */
  unlocks: PlayerUnlocks;
  cooldowns: Record<StrategicKind, number>;
  allies: number[];
  /** Players currently at war with this player. */
  wars: number[];
  pendingAllianceFrom: number[];
  transferSettings: TransferSettings;
  civilWarCooldown: number;
  /** Ticks before the government can change again. */
  governmentCooldown: number;
  /** Ticks remaining of a production boost coming from an event. */
  boostedTicks: number;
  cities: number;
  factories: number;
  ports: number;
  forts: number;
  silos: number;
  sams: number;
  airports: number;
  score: number;
}

export interface PlayerUnlocks {
  strategic: boolean;
  naval: boolean;
  air: boolean;
  /** The seventh ability slot, unlocked by the first port. */
  tradeCapacity: boolean;
}

export interface GameConfig {
  width: number;
  height: number;
  seed: number;
  maxPlayers: number;
  /** Number of AI nations spawned at game creation. */
  bots: number;
  /** Simulation ticks per second. */
  tickRate: number;
  /** 1..3, drives map generation parameters. */
  mapStyle: "continents" | "archipelago" | "pangaea";
}

export interface GameSnapshot {
  tick: number;
  config: GameConfig;
  map: MapInfo;
  players: PlayerState[];
  buildings: BuildingData[];
  boats: BoatData[];
  tradeShips: TradeShipData[];
  planes: PlaneData[];
  missiles: MissileData[];
  alliances: AllianceData[];
  relations: DiplomacyRelation[];
  requests: AllianceRequest[];
  events: WorldEvent[];
  /** base64 of the terrain layer (0 = ocean, 1..n = land region id). */
  terrain: string;
  /** base64 of the ownership layer (0 = unclaimed). */
  owner: string;
  scorch: number[];
  tickIntervalMs: number;
}

export interface TileChanges {
  /** Changed tile indices. */
  idx: number[];
  /** New owner per changed tile (same order). */
  owner: number[];
}

export interface GameUpdate {
  tick: number;
  players: PlayerState[];
  /**
   * Full building list, resent only when `buildingsVersion` changed since the
   * previous update (clients keep their copy otherwise).
   */
  buildings: BuildingData[];
  buildingsVersion: number;
  boats: BoatData[];
  tradeShips: TradeShipData[];
  planes: PlaneData[];
  missiles: MissileData[];
  alliances: AllianceData[];
  relations: DiplomacyRelation[];
  requests: AllianceRequest[];
  tileChanges: TileChanges;
  /** Tile indices currently scarred by strategic strikes. */
  scorch: number[];
  events: WorldEvent[];
  /** Major events that must raise a notification. */
  notifications: WorldEvent[];
}

export type GameMode = "conquest";

export interface ScoreEntry {
  playerId: number;
  country: string;
  flag: string;
  color: string;
  tiles: number;
  population: number;
  troops: number;
  money: number;
  score: number;
}
