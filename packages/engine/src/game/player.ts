/** Player (nation) state and helpers. */

import {
  DEFAULT_BALANCE,
  DEFAULT_TRANSFER_SETTINGS,
  type BalanceConfig,
  type CountryData,
  type GovernmentType,
  type PlayerState,
  type StrategicKind,
} from "@openwars/shared";

/** Engine-only fields on top of the state broadcast to clients. */
export interface PlayerInternal extends PlayerState {
  /** Fractional colonisation budget carried to the next tick. */
  colonyCarry: number;
  /** Troops lost recently, feeds discontent and decays over time. */
  recentLosses: number;
  /** Tick at which the bot (or the AI takeover) should think again. */
  nextThinkTick: number;
  /** Tick before which the government cannot change again. */
  governmentCooldown: number;
  lastAttackTick: number;
  /** Tick at which the player joined, used for spawn protection. */
  joinedTick: number;
}

export interface NewPlayerInput {
  id: number;
  name: string;
  country: CountryData;
  isBot: boolean;
  capital: number;
  tick: number;
  balance?: BalanceConfig;
}

export function createPlayer(input: NewPlayerInput): PlayerInternal {
  const balance = input.balance ?? DEFAULT_BALANCE;
  const cooldowns: Record<StrategicKind, number> = { missile: 0, mirv: 0, hydrogen: 0 };
  return {
    id: input.id,
    name: input.name,
    country: { ...input.country },
    isBot: input.isBot,
    alive: true,
    money: balance.startMoney,
    population: balance.startPopulation,
    maxPopulation: balance.startPopulation,
    troops: balance.startTroops,
    maxTroops: balance.startTroops,
    taxRate: 30,
    tiles: 0,
    capital: input.capital,
    incomePerTick: 0,
    unlocks: { strategic: false, naval: false, air: false, tradeCapacity: false },
    cooldowns,
    allies: [],
    wars: [],
    pendingAllianceFrom: [],
    transferSettings: { ...DEFAULT_TRANSFER_SETTINGS },
    civilWarCooldown: 0,
    boostedTicks: 0,
    cities: 0,
    factories: 0,
    ports: 0,
    forts: 0,
    silos: 0,
    sams: 0,
    airports: 0,
    score: 0,
    colonyCarry: 0,
    recentLosses: 0,
    nextThinkTick: input.tick + 20,
    governmentCooldown: 0,
    lastAttackTick: -1000,
    joinedTick: input.tick,
  };
}

/** Shifts a hex colour so rebels are visually distinct from their parent. */
export function shiftColor(hex: string, hueShift: number, lightness = 0): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "#8a8f98";
  const value = parseInt(match[1]!, 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  h = (h + hueShift + 360) % 360;
  s = Math.min(1, Math.max(0.35, s));
  const light = Math.min(0.9, Math.max(0.18, l + lightness));
  return hslToHex(h, s, light);
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const toHex = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function governmentLabel(type: GovernmentType, label: string): string {
  return label;
}
