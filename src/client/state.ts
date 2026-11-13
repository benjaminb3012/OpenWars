/** Client-side mirror of the authoritative game state. */

import {
  DEFAULT_BALANCE,
  type AllianceData,
  type AllianceRequest,
  type BoatData,
  type BuildingData,
  type GameConfig,
  type GameSnapshot,
  type GameUpdate,
  type MissileData,
  type PlaneData,
  type PlayerState,
  type RelationKind,
  type TradeShipData,
  type WorldEvent,
} from "@openwars/shared";

export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export type Listener = () => void;

export class Store {
  playerId = 0;
  config: GameConfig | null = null;
  tick = 0;
  tickIntervalMs = 100;
  width = 0;
  height = 0;
  terrain: Uint8Array | null = null;
  owner: Uint8Array | null = null;
  players = new Map<number, PlayerState>();
  buildings = new Map<number, BuildingData>();
  buildingsVersion = 0;
  boats: BoatData[] = [];
  tradeShips: TradeShipData[] = [];
  planes: PlaneData[] = [];
  missiles: MissileData[] = [];
  alliances: AllianceData[] = [];
  requests: AllianceRequest[] = [];
  relations = new Map<string, RelationKind>();
  scorch = new Set<number>();
  recentEvents: WorldEvent[] = [];
  connected = false;
  joined = false;
  lastError = "";
  lastInfo = "";

  private listeners: Listener[] = [];

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  applySnapshot(snapshot: GameSnapshot): void {
    this.config = snapshot.config;
    this.tick = snapshot.tick;
    this.tickIntervalMs = snapshot.tickIntervalMs;
    this.width = snapshot.map.width;
    this.height = snapshot.map.height;
    this.terrain = decodeBytes(snapshot.terrain);
    this.owner = decodeBytes(snapshot.owner);
    this.players = new Map(snapshot.players.map((player) => [player.id, player]));
    this.buildings = new Map(snapshot.buildings.map((building) => [building.id, building]));
    this.buildingsVersion = -1;
    this.boats = snapshot.boats;
    this.tradeShips = snapshot.tradeShips;
    this.planes = snapshot.planes;
    this.missiles = snapshot.missiles;
    this.alliances = snapshot.alliances;
    this.requests = snapshot.requests;
    this.relations = new Map(
      snapshot.relations.map((relation) => [relationKey(relation.a, relation.b), relation.kind]),
    );
    this.scorch = new Set(snapshot.scorch);
    this.recentEvents = snapshot.events.slice(-80);
    this.notify();
  }

  applyUpdate(update: GameUpdate): void {
    this.tick = update.tick;
    this.players = new Map(update.players.map((player) => [player.id, player]));
    if (update.buildingsVersion !== this.buildingsVersion) {
      if (update.buildings.length > 0 || this.buildings.size === 0) {
        this.buildings = new Map(update.buildings.map((building) => [building.id, building]));
      } else {
        // A version bump with an empty payload means everything was destroyed.
        this.buildings = new Map();
      }
      this.buildingsVersion = update.buildingsVersion;
    }
    this.boats = update.boats;
    this.tradeShips = update.tradeShips;
    this.planes = update.planes;
    this.missiles = update.missiles;
    this.alliances = update.alliances;
    this.requests = update.requests;
    this.relations = new Map(
      update.relations.map((relation) => [relationKey(relation.a, relation.b), relation.kind]),
    );
    if (this.owner) {
      for (let i = 0; i < update.tileChanges.idx.length; i++) {
        const tile = update.tileChanges.idx[i]!;
        if (tile < this.owner.length) this.owner[tile] = update.tileChanges.owner[i]!;
      }
    }
    this.scorch = new Set(update.scorch);
    if (update.events.length > 0) {
      this.recentEvents = [...this.recentEvents, ...update.events].slice(-120);
    }
    this.notify();
  }

  me(): PlayerState | undefined {
    return this.players.get(this.playerId);
  }

  player(id: number): PlayerState | undefined {
    return this.players.get(id);
  }

  relationWith(otherId: number): RelationKind {
    if (this.playerId === 0 || otherId === this.playerId) return "neutral";
    if (this.alliances.some((alliance) =>
      alliance.active &&
      alliance.members.includes(this.playerId) &&
      alliance.members.includes(otherId))) {
      return "ally";
    }
    return this.relations.get(relationKey(this.playerId, otherId)) ?? "neutral";
  }

  allianceOf(playerId: number): AllianceData | undefined {
    return this.alliances.find((alliance) => alliance.active && alliance.members.includes(playerId));
  }

  ownerAt(tile: number): number {
    return this.owner ? (this.owner[tile] ?? 0) : 0;
  }

  tileIndex(x: number, y: number): number {
    return Math.round(y) * this.width + Math.round(x);
  }

  balance = DEFAULT_BALANCE;

  pushEvent(event: WorldEvent): void {
    this.recentEvents = [...this.recentEvents, event].slice(-120);
  }
}

function decodeBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
