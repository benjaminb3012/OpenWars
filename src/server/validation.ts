/**
 * Wire validation. Everything coming from a socket is untrusted: the server
 * only forwards values that match the expected shape, and the engine validates
 * the game rules afterwards.
 */

import {
  BUILDING_TYPES,
  GOVERNMENT_TYPES,
  MAX_MESSAGE_BYTES,
  type BuildingType,
  type ClientMessage,
  type GiftKind,
  type GovernmentType,
  type StrategicKind,
} from "@openwars/shared";

const STRATEGIC_KINDS: readonly StrategicKind[] = ["missile", "mirv", "hydrogen"];
const GIFT_KINDS: readonly GiftKind[] = ["money", "troops"];
const BOAT_KINDS = ["transport", "warship"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function int(value: unknown): value is number {
  return finite(value) && Number.isInteger(value);
}

function shortText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function hexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed["t"] !== "string") return null;
  const message = parsed;
  switch (message["t"]) {
    case "join": {
      if (!shortText(message["name"], 24)) return null;
      if (!shortText(message["countryName"], 24)) return null;
      if (!shortText(message["flag"], 12)) return null;
      if (!hexColor(message["color"])) return null;
      const government = message["government"];
      if (typeof government !== "string") return null;
      if (!GOVERNMENT_TYPES.includes(government as GovernmentType)) return null;
      return {
        t: "join",
        name: message["name"].trim(),
        countryName: message["countryName"].trim(),
        flag: message["flag"],
        color: message["color"],
        government: government as GovernmentType,
      };
    }
    case "spectate":
      return { t: "spectate" };
    case "attack": {
      if (!finite(message["x"]) || !finite(message["y"])) return null;
      const troops = message["troops"];
      if (troops !== undefined && !finite(troops)) return null;
      return troops === undefined
        ? { t: "attack", x: message["x"], y: message["y"] }
        : { t: "attack", x: message["x"], y: message["y"], troops };
    }
    case "boat": {
      if (!finite(message["x"]) || !finite(message["y"])) return null;
      if (!finite(message["troops"])) return null;
      const kind = message["kind"];
      if (kind !== BOAT_KINDS[0] && kind !== BOAT_KINDS[1]) return null;
      return { t: "boat", x: message["x"], y: message["y"], troops: message["troops"], kind };
    }
    case "build": {
      if (!finite(message["x"]) || !finite(message["y"])) return null;
      const building = message["building"];
      if (typeof building !== "string") return null;
      if (!BUILDING_TYPES.includes(building as BuildingType)) return null;
      return { t: "build", building: building as BuildingType, x: message["x"], y: message["y"] };
    }
    case "upgrade":
      if (!int(message["buildingId"])) return null;
      return { t: "upgrade", buildingId: message["buildingId"] };
    case "alliance":
      if (!int(message["target"])) return null;
      return { t: "alliance", target: message["target"] };
    case "allianceResponse":
      if (!int(message["from"])) return null;
      if (typeof message["accept"] !== "boolean") return null;
      return { t: "allianceResponse", from: message["from"], accept: message["accept"] };
    case "breakAlliance":
      return { t: "breakAlliance" };
    case "gift": {
      if (!int(message["target"])) return null;
      if (!finite(message["amount"])) return null;
      const kind = message["kind"];
      if (typeof kind !== "string" || !GIFT_KINDS.includes(kind as GiftKind)) return null;
      return {
        t: "gift",
        target: message["target"],
        kind: kind as GiftKind,
        amount: Math.max(0, Math.floor(message["amount"])),
      };
    }
    case "transferSettings":
      if (!finite(message["moneyPercentage"]) || !finite(message["troopPercentage"])) return null;
      return {
        t: "transferSettings",
        moneyPercentage: message["moneyPercentage"],
        troopPercentage: message["troopPercentage"],
      };
    case "government": {
      const government = message["government"];
      if (typeof government !== "string") return null;
      if (!GOVERNMENT_TYPES.includes(government as GovernmentType)) return null;
      return { t: "government", government: government as GovernmentType };
    }
    case "tax":
      if (!finite(message["rate"])) return null;
      return { t: "tax", rate: message["rate"] };
    case "missile": {
      if (!finite(message["x"]) || !finite(message["y"])) return null;
      const kind = message["kind"];
      if (typeof kind !== "string" || !STRATEGIC_KINDS.includes(kind as StrategicKind)) return null;
      return { t: "missile", kind: kind as StrategicKind, x: message["x"], y: message["y"] };
    }
    case "ping":
      if (!finite(message["at"])) return null;
      return { t: "ping", at: message["at"] };
    default:
      return null;
  }
}
