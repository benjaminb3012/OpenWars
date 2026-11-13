/** Naval, aerial and strategic units. */

import type { StrategicKind } from "./strategic";
import type { BuildingType } from "./buildings";

export type BoatKind = "transport" | "warship";

export interface BoatData {
  id: number;
  ownerId: number;
  kind: BoatKind;
  /** Tile indices: start/current interpolated position and destination. */
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 0..1 progress along the path. */
  progress: number;
  /** Troops aboard (transports). */
  troops: number;
  hp: number;
  maxHp: number;
}

export interface TradeShipData {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  toX: number;
  toY: number;
  progress: number;
  /** Money delivered on arrival. */
  value: number;
}

export type PlaneKind = "trade" | "fighter";

export interface PlaneData {
  id: number;
  ownerId: number;
  kind: PlaneKind;
  x: number;
  y: number;
  toX: number;
  toY: number;
  progress: number;
  value: number;
}

export interface MissileData {
  id: number;
  ownerId: number;
  kind: StrategicKind;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  /** Ticks left before impact. */
  ticksToImpact: number;
  interception: number;
}

export interface SamSiteData {
  buildingId: number;
  ownerId: number;
  x: number;
  y: number;
  radius: number;
  cooldown: number;
  level: number;
}

export interface ScorchMark {
  tile: number;
  ticksLeft: number;
  severity: number;
}

export interface BuildingRef {
  type: BuildingType;
  tile: number;
  ownerId: number;
}
