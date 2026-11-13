/**
 * Wire protocol.
 *
 * Clients never mutate the game directly: they send *intents*. The server
 * validates them and the engine is the only place where state changes.
 */

import type { GovernmentType } from "./types/country";
import type { BuildingType } from "./types/buildings";
import type { GiftKind } from "./types/diplomacy";
import type { BoatKind } from "./types/military";
import type { StrategicKind } from "./types/strategic";
import type { GameSnapshot, GameUpdate } from "./types/game";

export interface JoinMessage {
  t: "join";
  name: string;
  countryName: string;
  flag: string;
  color: string;
  government: GovernmentType;
}

export type ClientMessage =
  | JoinMessage
  | { t: "spectate" }
  | { t: "attack"; x: number; y: number; troops?: number }
  | { t: "boat"; x: number; y: number; troops: number; kind: BoatKind }
  | { t: "build"; building: BuildingType; x: number; y: number }
  | { t: "upgrade"; buildingId: number }
  | { t: "alliance"; target: number }
  | { t: "allianceResponse"; from: number; accept: boolean }
  | { t: "breakAlliance" }
  | { t: "gift"; target: number; kind: GiftKind; amount: number }
  | { t: "transferSettings"; moneyPercentage: number; troopPercentage: number }
  | { t: "government"; government: GovernmentType }
  | { t: "tax"; rate: number }
  | { t: "missile"; kind: StrategicKind; x: number; y: number }
  | { t: "ping"; at: number };

export interface WelcomeMessage {
  t: "welcome";
  /** Player id, or 0 for a spectator. */
  playerId: number;
  snapshot: GameSnapshot;
}

export interface UpdateMessage {
  t: "update";
  update: GameUpdate;
}

export interface ErrorMessage {
  t: "error";
  message: string;
}

export interface InfoMessage {
  t: "info";
  message: string;
}

export type ServerMessage = WelcomeMessage | UpdateMessage | ErrorMessage | InfoMessage;

export const MAX_MESSAGE_BYTES = 512 * 1024;
