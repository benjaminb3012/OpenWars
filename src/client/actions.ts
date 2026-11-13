/** Everything the UI can ask the game to do. Implemented in main.ts. */

import type {
  BoatKind,
  BuildingType,
  GiftKind,
  GovernmentType,
  StrategicKind,
} from "@openwars/shared";

export type TargetMode =
  | { kind: "none" }
  | { kind: "build"; building: BuildingType }
  | { kind: "missile"; weapon: StrategicKind }
  | { kind: "boat"; boat: BoatKind };

export type PanelName = "build" | "politics" | "diplomacy" | "military" | "help";

export interface UiActions {
  attack(x: number, y: number, troops?: number): void;
  build(type: BuildingType, x: number, y: number): void;
  upgrade(buildingId: number): void;
  marineStrike(x: number, y: number, troops: number, kind: BoatKind): void;
  missile(kind: StrategicKind, x: number, y: number): void;
  requestAlliance(target: number): void;
  respondAlliance(from: number, accept: boolean): void;
  breakAlliance(): void;
  gift(target: number, kind: GiftKind, amount: number): void;
  setTransferSettings(money: number, troops: number): void;
  setGovernment(government: GovernmentType): void;
  setTax(rate: number): void;
  centerOn(tile: number): void;
  focusCapital(): void;
  openPanel(panel: PanelName | null): void;
  notify(message: string): void;
  getMode(): TargetMode;
  setMode(mode: TargetMode): void;
}
