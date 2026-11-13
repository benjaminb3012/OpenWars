/**
 * Building manager: placement rules, upgrades, destruction and the spatial
 * queries the rest of the simulation needs (forts, SAM sites, hubs).
 *
 * Buildings live in the engine, not in the UI: every effect below is applied
 * by the simulation on the server and broadcast to clients.
 */

import {
  BUILDINGS,
  type BuildingData,
  type BuildingSpec,
  type BuildingType,
} from "@openwars/shared";
import { clamp } from "@openwars/shared";
import { isWater, LAND } from "../map/grid";
import type { TerritoryIndex } from "../territory/propagation";

export interface PlacementCheck {
  ok: boolean;
  error?: string;
}

export class BuildingManager {
  readonly buildings = new Map<number, BuildingData>();
  /** Tile -> building id (0 = empty). */
  readonly tileBuilding: Int32Array;
  /** Tile -> owner of the road on that tile (0 = no road). */
  readonly road: Uint16Array;
  /** Tile -> building id of the road on that tile (0 = no road). */
  readonly roadBuildingId: Int32Array;
  private nextId = 1;
  private readonly counts = new Map<number, Map<BuildingType, number>>();
  private readonly levelSums = new Map<number, Map<BuildingType, number>>();

  constructor(
    private readonly terrain: Uint8Array,
    private readonly index: TerritoryIndex,
  ) {
    const size = this.terrain.length;
    this.tileBuilding = new Int32Array(size);
    this.road = new Uint16Array(size);
    this.roadBuildingId = new Int32Array(size);
  }

  spec(type: BuildingType): BuildingSpec {
    return BUILDINGS[type];
  }

  get(id: number): BuildingData | undefined {
    return this.buildings.get(id);
  }

  at(tile: number): BuildingData | undefined {
    const id = this.tileBuilding[tile]!;
    return id === 0 ? undefined : this.buildings.get(id);
  }

  countOf(playerId: number, type: BuildingType): number {
    return this.counts.get(playerId)?.get(type) ?? 0;
  }

  /** Sum of the levels of every building of a type owned by a player. */
  levelSumOf(playerId: number, type: BuildingType): number {
    return this.levelSums.get(playerId)?.get(type) ?? 0;
  }

  countsOf(playerId: number): Record<BuildingType, number> {
    const result: Record<BuildingType, number> = {
      city: 0,
      factory: 0,
      port: 0,
      fort: 0,
      missile_silo: 0,
      sam_launcher: 0,
      airport: 0,
      road: 0,
    };
    const map = this.counts.get(playerId);
    if (map) for (const [type, value] of map) result[type] = value;
    return result;
  }

  listOf(playerId: number): BuildingData[] {
    const result: BuildingData[] = [];
    for (const building of this.buildings.values()) {
      if (building.ownerId === playerId) result.push(building);
    }
    return result;
  }

  /** Forts of a player, as tile indices, ordered for deterministic iteration. */
  fortsOf(playerId: number): number[] {
    const tiles: number[] = [];
    for (const building of this.buildings.values()) {
      if (building.ownerId === playerId && building.type === "fort") tiles.push(building.tile);
    }
    tiles.sort((a, b) => a - b);
    return tiles;
  }

  /** SAM sites of a player, ordered by id. */
  samsOf(playerId: number): BuildingData[] {
    const sites: BuildingData[] = [];
    for (const building of this.buildings.values()) {
      if (building.ownerId === playerId && building.type === "sam_launcher") sites.push(building);
    }
    sites.sort((a, b) => a.id - b.id);
    return sites;
  }

  isCoastal(tile: number): boolean {
    const width = this.index.width;
    const height = this.index.height;
    const x = tile % width;
    const y = (tile - x) / width;
    if (x + 1 < width && isWater(this.terrain[tile + 1]!)) return true;
    if (x - 1 >= 0 && isWater(this.terrain[tile - 1]!)) return true;
    if (y + 1 < height && isWater(this.terrain[tile + width]!)) return true;
    if (y - 1 >= 0 && isWater(this.terrain[tile - width]!)) return true;
    return false;
  }

  canPlace(playerId: number, type: BuildingType, tile: number): PlacementCheck {
    if (tile < 0 || tile >= this.terrain.length) return { ok: false, error: "Case invalide" };
    if (this.terrain[tile] !== LAND) return { ok: false, error: "Il faut une case terrestre" };
    if (this.index.ownerOf(tile) !== playerId) {
      return { ok: false, error: "Cette case ne t'appartient pas" };
    }
    if (this.tileBuilding[tile] !== 0) return { ok: false, error: "Un bâtiment occupe déjà la case" };
    if (this.road[tile] !== 0) return { ok: false, error: "Une route occupe déjà la case" };
    const spec = BUILDINGS[type];
    if (spec.requiresCoast && !this.isCoastal(tile)) {
      return { ok: false, error: "Ce bâtiment doit être construit sur la côte" };
    }
    return { ok: true };
  }

  place(playerId: number, type: BuildingType, tile: number): BuildingData {
    const spec = BUILDINGS[type];
    const maxHp = 80 + spec.buildTicks;
    if (type === "road") {
      this.road[tile] = playerId;
      this.roadBuildingId[tile] = this.nextId;
      const building: BuildingData = {
        id: this.nextId++,
        ownerId: playerId,
        type,
        level: 1,
        tile,
        buildRemaining: spec.buildTicks,
        hp: maxHp,
        maxHp,
        connected: true,
      };
      this.buildings.set(building.id, building);
      this.bumpCount(playerId, type, 1);
      this.bumpLevel(playerId, type, 1);
      return building;
    }
    const building: BuildingData = {
      id: this.nextId++,
      ownerId: playerId,
      type,
      level: 1,
      tile,
      buildRemaining: spec.buildTicks,
      hp: maxHp,
      maxHp,
      connected: !spec.requiresNetwork,
    };
    this.buildings.set(building.id, building);
    this.tileBuilding[tile] = building.id;
    this.bumpCount(playerId, type, 1);
    this.bumpLevel(playerId, type, 1);
    return building;
  }

  upgrade(id: number, playerId: number): PlacementCheck & { cost: number } {
    const building = this.buildings.get(id);
    if (!building) return { ok: false, error: "Bâtiment introuvable", cost: 0 };
    if (building.ownerId !== playerId) return { ok: false, error: "Ce bâtiment n'est pas à toi", cost: 0 };
    const spec = BUILDINGS[building.type];
    if (building.level >= spec.maxLevel) {
      return { ok: false, error: "Niveau maximal atteint", cost: 0 };
    }
    const cost = Math.round(spec.upgradeCost * Math.pow(1.35, building.level - 1));
    return { ok: true, cost };
  }

  applyUpgrade(id: number): void {
    const building = this.buildings.get(id);
    if (!building) return;
    this.bumpLevel(building.ownerId, building.type, 1);
    building.level += 1;
    building.maxHp = Math.round(building.maxHp * 1.25);
    building.hp = building.maxHp;
    building.buildRemaining = Math.round(BUILDINGS[building.type].buildTicks * 0.4);
  }

  damage(id: number, amount: number): boolean {
    const building = this.buildings.get(id);
    if (!building) return false;
    building.hp -= amount;
    if (building.hp <= 0) {
      this.destroy(id);
      return true;
    }
    return false;
  }

  destroy(id: number): BuildingData | undefined {
    const building = this.buildings.get(id);
    if (!building) return undefined;
    this.buildings.delete(id);
    if (building.type === "road") {
      this.road[building.tile] = 0;
      this.roadBuildingId[building.tile] = 0;
    } else if (this.tileBuilding[building.tile] === id) {
      this.tileBuilding[building.tile] = 0;
    }
    this.bumpCount(building.ownerId, building.type, -1);
    this.bumpLevel(building.ownerId, building.type, -building.level);
    return building;
  }

  /** Destroys every building on a tile (called when a tile is conquered). */
  destroyOnTile(tile: number): BuildingData | undefined {
    const id = this.tileBuilding[tile]!;
    if (id !== 0) return this.destroy(id);
    const roadId = this.roadBuildingId[tile]!;
    if (roadId !== 0) return this.destroy(roadId);
    return undefined;
  }

  /**
   * Approximate share (0..1) of a nation's territory protected by a fort.
   * Used for happiness relief and civil-war resistance; cheap on purpose.
   */
  fortCoverage(playerId: number, ownedTiles: number): number {
    if (ownedTiles <= 0) return 0;
    const forts = this.fortsOf(playerId);
    if (forts.length === 0) return 0;
    let area = 0;
    for (const tile of forts) {
      const building = this.at(tile);
      const level = building ? building.level : 1;
      const radius = 6 + level * 2;
      area += Math.PI * radius * radius;
    }
    return clamp(area / ownedTiles, 0, 1);
  }

  /** Defence bonus (>= 1) at a tile, given the defender's fort tiles. */
  defenseMultiplierAt(tile: number, forts: readonly number[], width: number): number {
    let bonus = 0;
    const x = tile % width;
    const y = (tile - x) / width;
    for (const fortTile of forts) {
      const fx = fortTile % width;
      const fy = (fortTile - fx) / width;
      const dx = x - fx;
      const dy = y - fy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const building = this.at(fortTile);
      const level = building ? building.level : 1;
      const radius = 6 + level * 2;
      if (distance > radius) continue;
      const strength = (1 - distance / radius) * level * BUILDINGS.fort.effectPerLevel;
      if (strength > bonus) bonus = strength;
    }
    return 1 + bonus;
  }

  private bumpLevel(playerId: number, type: BuildingType, delta: number): void {
    let map = this.levelSums.get(playerId);
    if (!map) {
      map = new Map<BuildingType, number>();
      this.levelSums.set(playerId, map);
    }
    map.set(type, (map.get(type) ?? 0) + delta);
  }

  private bumpCount(playerId: number, type: BuildingType, delta: number): void {
    let map = this.counts.get(playerId);
    if (!map) {
      map = new Map<BuildingType, number>();
      this.counts.set(playerId, map);
    }
    map.set(type, (map.get(type) ?? 0) + delta);
  }
}
