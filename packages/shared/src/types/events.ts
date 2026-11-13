/** World events: the ticker at the top of the screen and the notification feed. */

export type EventCategory =
  | "war"
  | "civil_war"
  | "diplomacy"
  | "politics"
  | "economy"
  | "military"
  | "building"
  | "system";

/** 1 = background info, 2 = notable, 3 = major (also raises a notification). */
export type EventSeverity = 1 | 2 | 3;

export interface WorldEvent {
  /** Monotonic id, stable across clients so the ticker can deduplicate. */
  id: number;
  tick: number;
  category: EventCategory;
  severity: EventSeverity;
  /** Human readable sentence, built once by the engine. */
  message: string;
  /** Player ids concerned, for filtering ("mes événements" vs "monde"). */
  players: number[];
  /** Flag emojis to render before the message. */
  icons?: string[];
  /** Optional world coordinates (tile) the event points at. */
  tile?: number;
}

export const EVENT_CATEGORY_COLORS: Record<EventCategory, string> = {
  war: "#e2564a",
  civil_war: "#ff8b3d",
  diplomacy: "#4fb0e8",
  politics: "#c792ea",
  economy: "#f0c04a",
  military: "#e06b8b",
  building: "#5fd39a",
  system: "#9aa6b2",
};

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  war: "Guerre",
  civil_war: "Guerre civile",
  diplomacy: "Diplomatie",
  politics: "Politique",
  economy: "Économie",
  military: "Militaire",
  building: "Infrastructure",
  system: "Système",
};
