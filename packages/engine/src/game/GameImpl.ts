/**
 * GameImpl — the deterministic simulation.
 *
 * Responsibilities:
 *  - own the territory grid, the players, the buildings and the units;
 *  - validate and apply every player action (nothing is decided client-side);
 *  - run one tick: units, economy, colonisation, politics, civil wars, bots;
 *  - produce the per-tick update consumed by the server broadcast and the client.
 *
 * The class is host agnostic: it has no access to the network, timers or DOM.
 * A host (the Node server, a test, a replay) calls `try*` methods for intents
 * and `tick()` at a fixed rate.
 */

import {
  COUNTRY_PRESETS,
  DEFAULT_BALANCE,
  GOVERNMENT_TYPES,
  BUILDINGS,
  STRATEGIC_WEAPONS,
  clamp,
  type BalanceConfig,
  type BuildingData,
  type BuildingType,
  type CountryData,
  type GameConfig,
  type GameSnapshot,
  type GameUpdate,
  type GovernmentType,
  type PlayerState,
  type PlayerUnlocks,
  type RelationKind,
  type StrategicKind,
  type GiftKind,
  type BoatKind,
  type AllianceData,
  type AllianceRequest,
  type DiplomacyRelation,
  type BoatData,
  type MissileData,
  type PlaneData,
  type TradeShipData,
  type WorldEvent,
  type MapInfo,
} from "@openwars/shared";
import { generateMap, type GameMapData } from "../map/generate";
import { LAND, idxOf, isWater } from "../map/grid";
import {
  createWaveScratch,
  expandWave,
  findNearestOwnedTile,
  spreadFrontierSample,
  TerritoryIndex,
  type WaveScratch,
} from "../territory/propagation";
import { selectSecessionTiles } from "../territory/secession";
import { BuildingManager } from "../buildings/manager";
import { computeTransportNetworks } from "../economy/transport";
import { incomeBreakdown, maxPopulationOf } from "../economy/production";
import { EventLog } from "../events/world-events";
import { civilWarPossible, computeHappiness } from "../politics/happiness";
import {
  governmentOf,
  modifiersOf,
  moraleTroopFactor,
  stabilityProductionFactor,
} from "../politics/governments";
import { createRng, type Rng } from "../rng";
import { blastTiles, blastStrength, interceptionProbability, mirvOffsets } from "../military/strategic";
import { isCoastalTile, waterLineClear } from "../military/naval";
import { createPlayer, shiftColor, type PlayerInternal } from "./player";
import { runBots } from "../ai/bot";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface AddPlayerInput {
  name: string;
  countryName: string;
  flag: string;
  color: string;
  government: GovernmentType;
  isBot: boolean;
}

interface ScorchEntry {
  ticks: number;
  severity: number;
}

const RELATION_NEUTRAL: RelationKind = "neutral";

export class GameImpl {
  readonly config: GameConfig;
  readonly balance: BalanceConfig;
  readonly map: GameMapData;
  readonly index: TerritoryIndex;
  readonly buildings: BuildingManager;
  readonly info: MapInfo;

  tick = 0;
  private readonly rng: Rng;
  private readonly scratch: WaveScratch;
  private readonly players: Array<PlayerInternal | null> = [null];
  private readonly alliances = new Map<number, AllianceData>();
  private requests: AllianceRequest[] = [];
  private readonly relations = new Map<string, RelationKind>();
  private readonly events: EventLog;
  private readonly usedSpawns = new Set<number>();

  private boats: BoatData[] = [];
  private tradeShips: TradeShipData[] = [];
  private planes: PlaneData[] = [];
  private missiles: MissileData[] = [];
  private readonly scorch = new Map<number, ScorchEntry>();

  private nextAllianceId = 1;
  private nextUnitId = 1;
  private networksDirty = true;
  private buildingsVersion = 1;
  private dirtyTiles = new Set<number>();
  private dirtyScorch: number[] = [];
  private commerceIncome = new Map<number, number>();
  private botSpawnAt = 0;

  constructor(config: GameConfig, balance: BalanceConfig = DEFAULT_BALANCE) {
    this.config = config;
    this.balance = balance;
    this.rng = createRng(config.seed);
    this.map = generateMap({
      width: config.width,
      height: config.height,
      seed: config.seed,
      style: config.mapStyle,
      playerCount: Math.max(config.maxPlayers, config.bots),
    });
    this.index = new TerritoryIndex(this.map.width, this.map.height);
    this.buildings = new BuildingManager(this.map.terrain, this.index);
    this.scratch = createWaveScratch(this.map.terrain.length);
    this.events = new EventLog(balance.eventHistorySize);
    this.info = {
      width: this.map.width,
      height: this.map.height,
      seed: this.map.seed,
      landTiles: this.map.landTiles,
      spawns: [...this.map.spawns],
    };
    // Bots join a little later so human players can take the good spawns first.
    this.botSpawnAt = Math.round(balance.spawnGraceTicks);
  }

  // ---------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------

  get(id: number): PlayerInternal | undefined {
    const player = this.players[id];
    return player ?? undefined;
  }

  allPlayers(): PlayerInternal[] {
    const result: PlayerInternal[] = [];
    for (const player of this.players) if (player) result.push(player);
    return result;
  }

  alivePlayers(): PlayerInternal[] {
    return this.allPlayers().filter((player) => player.alive);
  }

  playerCount(): number {
    return this.allPlayers().length;
  }

  addPlayer(input: AddPlayerInput): { ok: true; id: number } | { ok: false; error: string } {
    if (this.allPlayers().length >= this.config.maxPlayers + 4) {
      return { ok: false, error: "La partie est complète" };
    }
    const spawn = this.pickSpawn();
    if (spawn === -1) {
      if (input.isBot) return { ok: false, error: "Plus de zone de départ disponible" };
      // No spawn left: hand over the weakest AI nation to the human player.
      const takeover = this.takeOverWeakestBot(input);
      if (takeover) return { ok: true, id: takeover };
      return { ok: false, error: "Plus de zone de départ disponible" };
    }
    const id = this.players.length;
    const country: CountryData = {
      name: input.countryName,
      flag: input.flag,
      color: input.color,
      government: input.government,
      happiness: 65,
      discontent: 0,
    };
    const player = createPlayer({
      id,
      name: input.name,
      country,
      isBot: input.isBot,
      capital: spawn,
      tick: this.tick,
      balance: this.balance,
    });
    this.players.push(player);
    this.usedSpawns.add(spawn);
    this.claimInitialTerritory(id, spawn);
    player.tiles = this.index.count(id);
    this.events.emit({
      tick: this.tick,
      category: "politics",
      severity: input.isBot ? 1 : 2,
      message: `${input.flag} ${input.countryName} fait son entrée sur la scène mondiale (${governmentOf(input.government).label}).`,
      players: [id],
      icons: [input.flag],
      tile: spawn,
    });
    return { ok: true, id };
  }

  private takeOverWeakestBot(input: AddPlayerInput): number | null {
    const bots = this.alivePlayers().filter((player) => player.isBot);
    if (bots.length === 0) return null;
    bots.sort((a, b) => a.tiles - b.tiles || a.id - b.id);
    const bot = bots[0]!;
    bot.isBot = false;
    bot.name = input.name;
    bot.country.name = input.countryName;
    bot.country.flag = input.flag;
    bot.country.color = input.color;
    bot.country.government = input.government;
    this.events.emit({
      tick: this.tick,
      category: "politics",
      severity: 2,
      message: `${input.flag} ${input.countryName} prend le contrôle de la nation ${bot.country.name}.`,
      players: [bot.id],
      icons: [input.flag],
      tile: bot.capital,
    });
    return bot.id;
  }

  private pickSpawn(): number {
    for (const spawn of this.map.spawns) {
      if (!this.usedSpawns.has(spawn)) return spawn;
    }
    return -1;
  }

  private claimInitialTerritory(playerId: number, spawn: number): void {
    const terrain = this.map.terrain;
    // Every nation starts with a comparable foothold (~14-20 tiles).
    const target = Math.max(18, Math.round(Math.sqrt(this.map.landTiles) * 0.12));
    this.setOwner(spawn, playerId);
    expandWave({
      index: this.index,
      terrain,
      origins: [spawn],
      budget: target,
      costPerTile: () => 1,
      canClaim: (tile, owner) => owner === 0 && terrain[tile] === LAND,
      maxTiles: target - 1,
      scratch: this.scratch,
      onClaim: (tile) => this.setOwner(tile, playerId),
    });
  }

  // ---------------------------------------------------------------------
  // Territory helpers
  // ---------------------------------------------------------------------

  private setOwner(tile: number, playerId: number): void {
    const previous = this.index.ownerOf(tile);
    if (previous === playerId) return;
    this.index.setOwner(tile, playerId);
    this.dirtyTiles.add(tile);
    if (previous !== 0) {
      const previousPlayer = this.get(previous);
      if (previousPlayer) previousPlayer.tiles = this.index.count(previous);
    }
    const player = this.get(playerId);
    if (player) player.tiles = this.index.count(playerId);
  }

  private refreshTerritoryCounts(): void {
    for (const player of this.allPlayers()) player.tiles = this.index.count(player.id);
  }

  /** Owned tiles adjacent to a sample of the frontier, used as wave seeds. */
  private frontierSeeds(playerId: number, sampleSize: number): number[] {
    const frontier = this.index.frontierOf(playerId);
    const sample = spreadFrontierSample(frontier, sampleSize, this.tick + playerId * 17);
    const seeds: number[] = [];
    const width = this.index.width;
    for (const tile of sample) {
      const x = tile % width;
      const y = (tile - x) / width;
      let seed = -1;
      if (x + 1 < this.map.width && this.index.ownerOf(tile + 1) === playerId) seed = tile + 1;
      else if (x - 1 >= 0 && this.index.ownerOf(tile - 1) === playerId) seed = tile - 1;
      else if (y + 1 < this.map.height && this.index.ownerOf(tile + width) === playerId) seed = tile + width;
      else if (y - 1 >= 0 && this.index.ownerOf(tile - width) === playerId) seed = tile - width;
      if (seed !== -1) seeds.push(seed);
    }
    return seeds;
  }

  // ---------------------------------------------------------------------
  // Player actions (all validated here)
  // ---------------------------------------------------------------------

  tryAttack(playerId: number, x: number, y: number, troopsRequested?: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Coordonnées invalides" };
    const tile = this.tileAt(x, y);
    if (tile === -1) return { ok: false, error: "Cible hors de la carte" };
    const terrain = this.map.terrain;
    if (terrain[tile] !== LAND) return { ok: false, error: "On ne conquiert pas la mer" };
    const defenderId = this.index.ownerOf(tile);
    if (defenderId === playerId) return { ok: false, error: "Cette case est déjà à toi" };
    const defender = defenderId !== 0 ? this.get(defenderId) : undefined;
    if (defender) {
      if (!defender.alive) return { ok: false, error: "Cette nation n'existe plus" };
      if (this.relationBetween(playerId, defenderId) === "ally") {
        return { ok: false, error: "Tu ne peux pas attaquer un allié : romps l'alliance d'abord" };
      }
      if (this.tick - defender.joinedTick < this.balance.spawnProtectionTicks) {
        return { ok: false, error: "Cette nation est encore protégée à son arrivée" };
      }
    }
    const origin = findNearestOwnedTile(
      this.index,
      terrain,
      x,
      y,
      playerId,
      this.balance.attackFrontierRadius,
    );
    if (origin === -1) {
      return { ok: false, error: "Aucune de tes frontières n'est assez proche de cette cible" };
    }

    const maxCommit = Math.floor(player.troops * this.balance.maxAttackCommitment);
    if (maxCommit < 10) return { ok: false, error: "Pas assez de troupes pour attaquer" };
    const requested = troopsRequested === undefined ? maxCommit : Math.floor(troopsRequested);
    if (requested < 10) return { ok: false, error: "Envoie au moins 10 troupes" };
    const commit = Math.min(requested, maxCommit);
    const forts = defender ? this.buildings.fortsOf(defenderId) : [];
    const width = this.map.width;
    const defenderTroopFactor = defender ? 1 + Math.min(1.5, defender.troops / 900) : 1;

    const wave = expandWave({
      index: this.index,
      terrain,
      origins: [origin],
      budget: commit,
      costPerTile: (tileIndex) =>
        this.balance.attackCostPerTile *
        this.buildings.defenseMultiplierAt(tileIndex, forts, width) *
        defenderTroopFactor,
      canClaim: (tileIndex, owner) => owner === defenderId && terrain[tileIndex] === LAND,
      maxTiles: this.balance.maxTilesPerAttack,
      scratch: this.scratch,
      onClaim: (tileIndex) => {
        const destroyed = this.buildings.destroyOnTile(tileIndex);
        if (destroyed && destroyed.level >= 2) {
          this.events.emit({
            tick: this.tick,
            category: "war",
            severity: 2,
            message: `${BUILDINGS[destroyed.type].icon} ${BUILDINGS[destroyed.type].label} détruit(e) par ${player.country.name}.`,
            players: [playerId, defenderId],
            tile: tileIndex,
            dedupeKey: `destroy:${tileIndex}`,
          });
        }
        if (destroyed) this.networksDirty = true;
        this.setOwner(tileIndex, playerId);
      },
    });

    const captured = wave.claimed.length;
    if (captured === 0) {
      return { ok: false, error: "Aucune case conquise : les défenses sont trop fortes" };
    }

    player.troops = Math.max(0, player.troops - Math.min(commit, wave.spent));
    player.lastAttackTick = this.tick;

    if (defender) {
      const losses = Math.min(
        defender.troops,
        captured * this.balance.attackDefenderLossPerTile * (1 + defender.troops / 4000),
      );
      defender.troops = Math.max(0, defender.troops - losses);
      defender.recentLosses += losses;
      this.setRelation(playerId, defenderId, "war");
      this.events.emit({
        tick: this.tick,
        category: "war",
        severity: captured > 25 ? 3 : 2,
        message: `${player.country.flag} ${player.country.name} attaque ${defender.country.flag} ${defender.country.name} : ${captured} case(s) conquise(s).`,
        players: [playerId, defenderId],
        icons: [player.country.flag, defender.country.flag],
        tile,
        dedupeKey: `attack:${playerId}:${defenderId}`,
      });
    } else {
      this.events.emit({
        tick: this.tick,
        category: "military",
        severity: 1,
        message: `${player.country.flag} ${player.country.name} étend son territoire sur ${captured} case(s).`,
        players: [playerId],
        tile,
        dedupeKey: `colonise:${playerId}`,
      });
    }
    return { ok: true };
  }

  tryColoniseTile(playerId: number, x: number, y: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    const tile = this.tileAt(x, y);
    if (tile === -1) return { ok: false, error: "Cible hors de la carte" };
    if (this.map.terrain[tile] !== LAND) return { ok: false, error: "Case maritime" };
    if (this.index.ownerOf(tile) !== 0) return { ok: false, error: "Case déjà occupée" };
    const origin = findNearestOwnedTile(
      this.index,
      this.map.terrain,
      x,
      y,
      playerId,
      this.balance.attackFrontierRadius,
    );
    if (origin === -1) return { ok: false, error: "Trop loin de ta frontière" };
    const result = expandWave({
      index: this.index,
      terrain: this.map.terrain,
      origins: [origin],
      budget: this.balance.maxTilesPerAttack * this.balance.colonizeCost,
      costPerTile: () => this.balance.colonizeCost,
      canClaim: (tileIndex, owner) => owner === 0 && this.map.terrain[tileIndex] === LAND,
      maxTiles: this.balance.maxTilesPerAttack,
      scratch: this.scratch,
      onClaim: (tileIndex) => this.setOwner(tileIndex, playerId),
    });
    const cost = result.spent;
    if (player.money < cost) return { ok: false, error: "Pas assez d'argent" };
    player.money -= cost;
    return { ok: true };
  }

  tryBuild(playerId: number, type: BuildingType, x: number, y: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!(type in BUILDINGS)) return { ok: false, error: "Bâtiment inconnu" };
    const tile = this.tileAt(x, y);
    if (tile === -1) return { ok: false, error: "Case hors de la carte" };
    const check = this.buildings.canPlace(playerId, type, tile);
    if (!check.ok) return { ok: false, error: check.error };
    const spec = BUILDINGS[type];
    if (player.money < spec.cost) {
      return { ok: false, error: `Il te manque ${Math.ceil(spec.cost - player.money)} $` };
    }
    player.money -= spec.cost;
    const building = this.buildings.place(playerId, type, tile);
    this.networksDirty = true;
    this.buildingsVersion++;
    if (type !== "road") {
      this.events.emit({
        tick: this.tick,
        category: "building",
        severity: type === "missile_silo" || type === "airport" ? 2 : 1,
        message: `${spec.icon} ${player.country.flag} ${player.country.name} lance la construction d'un(e) ${spec.label.toLowerCase()}.`,
        players: [playerId],
        tile: building!.tile,
        dedupeKey: `build:${playerId}:${type}:${tile}`,
      });
    }
    return { ok: true };
  }

  tryBuildRoadPath(playerId: number, fromTile: number, toTile: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    const width = this.map.width;
    const ax = fromTile % width;
    const ay = (fromTile - ax) / width;
    const bx = toTile % width;
    const by = (toTile - bx) / width;
    const tiles: number[] = [];
    let x = ax;
    let y = ay;
    while (x !== bx) {
      x += x < bx ? 1 : -1;
      tiles.push(y * width + x);
    }
    while (y !== by) {
      y += y < by ? 1 : -1;
      tiles.push(y * width + x);
    }
    let built = 0;
    for (const tile of tiles) {
      if (this.index.ownerOf(tile) !== playerId) continue;
      if (this.buildings.road[tile] !== 0) continue;
      if (this.buildings.tileBuilding[tile] !== 0) continue;
      if (this.map.terrain[tile] !== LAND) continue;
      if (player.money < BUILDINGS.road.cost) break;
      player.money -= BUILDINGS.road.cost;
      this.buildings.place(playerId, "road", tile);
      built++;
    }
    if (built > 0) {
      this.networksDirty = true;
      this.buildingsVersion++;
      return { ok: true };
    }
    return { ok: false, error: "Aucune route construite" };
  }

  tryUpgrade(playerId: number, buildingId: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    const check = this.buildings.upgrade(buildingId, playerId);
    if (!check.ok) return { ok: false, error: check.error };
    if (player.money < check.cost) return { ok: false, error: "Pas assez d'argent" };
    player.money -= check.cost;
    this.buildings.applyUpgrade(buildingId);
    this.networksDirty = true;
    this.buildingsVersion++;
    const building = this.buildings.get(buildingId);
    if (building) {
      this.events.emit({
        tick: this.tick,
        category: "building",
        severity: building.level >= 4 ? 2 : 1,
        message: `${BUILDINGS[building.type].icon} ${BUILDINGS[building.type].label} de ${player.country.name} amélioré(e) au niveau ${building.level}.`,
        players: [playerId],
        tile: building.tile,
        dedupeKey: `upgrade:${buildingId}:${building.level}`,
      });
    }
    return { ok: true };
  }

  trySendBoat(
    playerId: number,
    x: number,
    y: number,
    troops: number,
    kind: BoatKind,
  ): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!player.unlocks.naval) return { ok: false, error: "Construis un port pour débloquer la marine" };
    const target = this.tileAt(x, y);
    if (target === -1) return { ok: false, error: "Cible hors de la carte" };
    const width = this.map.width;
    if (this.map.terrain[target] !== LAND) return { ok: false, error: "Il faut viser une côte" };
    if (!isCoastalTile(this.map.terrain, width, this.map.height, target)) {
      return { ok: false, error: "La cible doit être sur la côte" };
    }
    const ports = this.buildings
      .listOf(playerId)
      .filter((building) => building.type === "port")
      .sort((a, b) => a.id - b.id);
    if (ports.length === 0) return { ok: false, error: "Aucun port disponible" };
    const origin = ports[0]!;
    const ox = origin.tile % width;
    const oy = (origin.tile - ox) / width;
    const tx = target % width;
    const ty = (target - tx) / width;
    if (!waterLineClear(this.map.terrain, width, this.map.height, ox, oy, tx, ty)) {
      return { ok: false, error: "La route maritime est bloquée par des terres" };
    }
    const isWarship = kind === "warship";
    const cost = isWarship ? this.balance.warshipCost : this.balance.boatCost;
    if (!isWarship) {
      const send = Math.floor(troops);
      if (send < 20) return { ok: false, error: "Embarque au moins 20 troupes" };
      if (send > player.troops) return { ok: false, error: "Pas assez de troupes" };
      player.troops -= send;
      this.boats.push({
        id: this.nextUnitId++,
        ownerId: playerId,
        kind: "transport",
        x: ox,
        y: oy,
        fromX: ox,
        fromY: oy,
        toX: tx,
        toY: ty,
        progress: 0,
        troops: send,
        hp: this.balance.boatHp,
        maxHp: this.balance.boatHp,
      });
    } else {
      if (player.money < cost) return { ok: false, error: "Pas assez d'argent" };
      player.money -= cost;
      this.boats.push({
        id: this.nextUnitId++,
        ownerId: playerId,
        kind: "warship",
        x: ox,
        y: oy,
        fromX: ox,
        fromY: oy,
        toX: tx,
        toY: ty,
        progress: 0,
        troops: 0,
        hp: this.balance.warshipHp,
        maxHp: this.balance.warshipHp,
      });
    }
    this.events.emit({
      tick: this.tick,
      category: "military",
      severity: 2,
      message: isWarship
        ? `🚢 ${player.country.flag} ${player.country.name} déploie un bateau de guerre.`
        : `⛵ ${player.country.flag} ${player.country.name} lance un débarquement (${Math.floor(troops)} troupes).`,
      players: [playerId],
      tile: target,
      dedupeKey: `boat:${playerId}`,
    });
    return { ok: true };
  }

  tryLaunchMissile(playerId: number, kind: StrategicKind, x: number, y: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    const spec = STRATEGIC_WEAPONS[kind];
    if (!spec) return { ok: false, error: "Arme inconnue" };
    const silos = this.buildings
      .listOf(playerId)
      .filter((building) => building.type === "missile_silo");
    if (silos.length === 0) return { ok: false, error: "Construis un lance-missiles" };
    const bestLevel = Math.max(...silos.map((silo) => silo.level));
    if (bestLevel < spec.requiredSiloLevel) {
      return { ok: false, error: `Lance-missiles niveau ${spec.requiredSiloLevel} requis` };
    }
    if (player.cooldowns[kind] > 0) {
      return { ok: false, error: `Rechargement : ${Math.ceil(player.cooldowns[kind] / this.balance.tickRate)} s` };
    }
    if (player.money < spec.cost) return { ok: false, error: "Pas assez d'argent" };
    const target = this.tileAt(x, y);
    if (target === -1) return { ok: false, error: "Cible hors de la carte" };
    player.money -= spec.cost;
    player.cooldowns[kind] = spec.cooldownTicks;
    const silo = silos[0]!;
    const width = this.map.width;
    const sx = silo.tile % width;
    const sy = (silo.tile - sx) / width;
    const tx = target % width;
    const ty = (target - tx) / width;
    const offsets = mirvOffsets(spec.warheads);
    for (const offset of offsets) {
      const dx = Math.round(tx + offset.dx);
      const dy = Math.round(ty + offset.dy);
      if (dx < 0 || dy < 0 || dx >= width || dy >= this.map.height) continue;
      this.missiles.push({
        id: this.nextUnitId++,
        ownerId: playerId,
        kind,
        fromX: sx,
        fromY: sy,
        toX: dx,
        toY: dy,
        progress: 0,
        ticksToImpact: spec.flightTicks,
        interception: 0,
      });
    }
    this.events.emit({
      tick: this.tick,
      category: "military",
      severity: 3,
      message: `${spec.icon} ${player.country.flag} ${player.country.name} tire un ${spec.label.toLowerCase()} !`,
      players: [playerId],
      tile: target,
      dedupeKey: `launch:${playerId}:${kind}`,
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------
  // Diplomacy
  // ---------------------------------------------------------------------

  tryRequestAlliance(playerId: number, targetId: number): ActionResult {
    const player = this.get(playerId);
    const target = this.get(targetId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!target || !target.alive) return { ok: false, error: "Nation cible invalide" };
    if (playerId === targetId) return { ok: false, error: "Tu ne peux pas t'allier à toi-même" };
    const relation = this.relationBetween(playerId, targetId);
    if (relation === "ally") return { ok: false, error: "Vous êtes déjà alliés" };
    if (relation === "war" && this.tick - player.lastAttackTick < 200) {
      return { ok: false, error: "Trop tôt après un conflit" };
    }
    if (this.requests.some((request) => request.fromId === playerId && request.toId === targetId)) {
      return { ok: true };
    }
    this.requests = this.requests.filter(
      (request) => !(request.fromId === playerId && request.toId === targetId),
    );
    this.requests.push({ fromId: playerId, toId: targetId, createdAtTick: this.tick });
    this.refreshDiplomacyViews();
    this.events.emit({
      tick: this.tick,
      category: "diplomacy",
      severity: 2,
      message: `🤝 ${player.country.flag} ${player.country.name} propose une alliance à ${target.country.flag} ${target.country.name}.`,
      players: [playerId, targetId],
      dedupeKey: `alliance-req:${playerId}:${targetId}`,
    });
    return { ok: true };
  }

  tryRespondAlliance(playerId: number, fromId: number, accept: boolean): ActionResult {
    const player = this.get(playerId);
    const from = this.get(fromId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!from || !from.alive) return { ok: false, error: "Nation introuvable" };
    const index = this.requests.findIndex(
      (request) => request.fromId === fromId && request.toId === playerId,
    );
    if (index === -1) return { ok: false, error: "Aucune demande d'alliance en attente" };
    this.requests.splice(index, 1);
    if (!accept) {
      this.events.emit({
        tick: this.tick,
        category: "diplomacy",
        severity: 1,
        message: `❌ ${player.country.flag} ${player.country.name} refuse l'alliance de ${from.country.flag} ${from.country.name}.`,
        players: [playerId, fromId],
        dedupeKey: `alliance-no:${playerId}:${fromId}`,
      });
      this.refreshDiplomacyViews();
      return { ok: true };
    }
    const alliance: AllianceData = {
      id: this.nextAllianceId++,
      members: [fromId, playerId].sort((a, b) => a - b),
      troopTransferPercentage: 0,
      moneyTransferPercentage: 0,
      active: true,
      createdAtTick: this.tick,
    };
    this.alliances.set(alliance.id, alliance);
    this.setRelation(fromId, playerId, "ally");
    this.refreshDiplomacyViews();
    this.events.emit({
      tick: this.tick,
      category: "diplomacy",
      severity: 3,
      message: `🤝 Alliance conclue entre ${from.country.flag} ${from.country.name} et ${player.country.flag} ${player.country.name}.`,
      players: [fromId, playerId],
      icons: [from.country.flag, player.country.flag],
    });
    return { ok: true };
  }

  tryBreakAlliance(playerId: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    const alliance = this.allianceOf(playerId);
    if (!alliance) return { ok: false, error: "Aucune alliance active" };
    this.alliances.delete(alliance.id);
    for (const a of alliance.members) {
      for (const b of alliance.members) {
        if (a === b) continue;
        this.setRelation(a, b, "neutral");
      }
    }
    this.refreshDiplomacyViews();
    this.events.emit({
      tick: this.tick,
      category: "diplomacy",
      severity: 2,
      message: `💔 ${player.country.flag} ${player.country.name} rompt son alliance.`,
      players: alliance.members,
      dedupeKey: `alliance-break:${playerId}`,
    });
    return { ok: true };
  }

  tryGift(playerId: number, targetId: number, kind: GiftKind, amount: number): ActionResult {
    const player = this.get(playerId);
    const target = this.get(targetId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!target || !target.alive) return { ok: false, error: "Nation cible invalide" };
    if (this.relationBetween(playerId, targetId) !== "ally") {
      return { ok: false, error: "Il faut une alliance pour transférer des ressources" };
    }
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Montant invalide" };
    if (kind === "money") {
      const value = Math.min(Math.floor(amount), Math.floor(player.money));
      if (value <= 0) return { ok: false, error: "Pas assez d'argent" };
      player.money -= value;
      target.money += value;
      this.events.emit({
        tick: this.tick,
        category: "diplomacy",
        severity: 1,
        message: `💰 ${player.country.name} envoie ${Math.round(value)} $ à ${target.country.name}.`,
        players: [playerId, targetId],
        dedupeKey: `gift-money:${playerId}:${targetId}`,
      });
      return { ok: true };
    }
    const troops = Math.min(Math.floor(amount), Math.floor(player.troops));
    if (troops <= 0) return { ok: false, error: "Pas assez de troupes" };
    player.troops -= troops;
    target.troops = Math.min(target.maxTroops * 1.2, target.troops + troops);
    this.events.emit({
      tick: this.tick,
      category: "diplomacy",
      severity: 1,
      message: `🎖️ ${player.country.name} envoie ${troops} troupes à ${target.country.name}.`,
      players: [playerId, targetId],
      dedupeKey: `gift-troops:${playerId}:${targetId}`,
    });
    return { ok: true };
  }

  trySetTransferSettings(
    playerId: number,
    moneyPercentage: number,
    troopPercentage: number,
  ): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!this.allianceOf(playerId)) return { ok: false, error: "Aucune alliance active" };
    player.transferSettings.moneyPercentage = clamp(Math.round(moneyPercentage), 0, 50);
    player.transferSettings.troopPercentage = clamp(Math.round(troopPercentage), 0, 50);
    player.transferSettings.allowAutoTransfers =
      player.transferSettings.moneyPercentage > 0 || player.transferSettings.troopPercentage > 0;
    const alliance = this.allianceOf(playerId)!;
    alliance.moneyTransferPercentage = player.transferSettings.moneyPercentage;
    alliance.troopTransferPercentage = player.transferSettings.troopPercentage;
    return { ok: true };
  }

  trySetGovernment(playerId: number, government: GovernmentType): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (player.country.government === government) return { ok: false, error: "Régime inchangé" };
    if (player.governmentCooldown > 0) {
      return {
        ok: false,
        error: `Changement disponible dans ${Math.ceil(player.governmentCooldown / this.balance.tickRate)} s`,
      };
    }
    player.country.government = government;
    player.governmentCooldown = this.balance.governmentChangeCooldownTicks;
    player.country.discontent = Math.min(100, player.country.discontent + 18);
    const spec = governmentOf(government);
    this.events.emit({
      tick: this.tick,
      category: "politics",
      severity: 3,
      message: `${spec.icon} ${player.country.flag} ${player.country.name} devient ${spec.label.toLowerCase()}.`,
      players: [playerId],
    });
    return { ok: true };
  }

  trySetTax(playerId: number, rate: number): ActionResult {
    const player = this.get(playerId);
    if (!player || !player.alive) return { ok: false, error: "Nation introuvable" };
    if (!Number.isFinite(rate)) return { ok: false, error: "Taux invalide" };
    player.taxRate = clamp(Math.round(rate), 10, 90);
    return { ok: true };
  }

  relationBetween(a: number, b: number): RelationKind {
    if (a === b) return "neutral";
    return this.relations.get(relationKey(a, b)) ?? RELATION_NEUTRAL;
  }

  allianceOf(playerId: number): AllianceData | undefined {
    for (const alliance of this.alliances.values()) {
      if (alliance.active && alliance.members.includes(playerId)) return alliance;
    }
    return undefined;
  }

  private setRelation(a: number, b: number, kind: RelationKind): void {
    const key = relationKey(a, b);
    if (kind === "neutral") this.relations.delete(key);
    else this.relations.set(key, kind);
  }

  private refreshDiplomacyViews(): void {
    for (const player of this.allPlayers()) {
      player.allies = [];
      player.wars = [];
      player.pendingAllianceFrom = [];
    }
    for (const [key, kind] of this.relations) {
      const [aText, bText] = key.split(":");
      const a = Number(aText);
      const b = Number(bText);
      const playerA = this.get(a);
      const playerB = this.get(b);
      if (!playerA || !playerB) continue;
      if (kind === "ally") {
        playerA.allies.push(b);
        playerB.allies.push(a);
      } else if (kind === "war" || kind === "civil_war") {
        playerA.wars.push(b);
        playerB.wars.push(a);
      }
    }
    for (const request of this.requests) {
      const target = this.get(request.toId);
      if (target) target.pendingAllianceFrom.push(request.fromId);
    }
    for (const player of this.allPlayers()) {
      player.allies.sort((x, y) => x - y);
      player.wars.sort((x, y) => x - y);
      player.pendingAllianceFrom.sort((x, y) => x - y);
    }
  }

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------
  // (tick pipeline and subsystems are defined below, in the same class)

  private tileAt(x: number, y: number): number {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return -1;
    return idxOf(this.map.width, tx, ty);
  }

  private unlocked(player: PlayerInternal): PlayerUnlocks {
    const counts = this.buildings.countsOf(player.id);
    return {
      strategic: counts.missile_silo > 0,
      naval: counts.port > 0,
      air: counts.airport > 0,
      tradeCapacity: counts.port > 0,
    };
  }

  /** Exposed for tests and bots. */
  stateOf(playerId: number): PlayerState | undefined {
    return this.playerState(this.get(playerId));
  }

  private playerState(player: PlayerInternal | undefined): PlayerState | undefined {
    if (!player) return undefined;
    return {
      id: player.id,
      name: player.name,
      country: player.country,
      isBot: player.isBot,
      alive: player.alive,
      money: Math.round(player.money),
      population: Math.round(player.population),
      maxPopulation: Math.round(player.maxPopulation),
      troops: Math.round(player.troops),
      maxTroops: Math.round(player.maxTroops),
      taxRate: player.taxRate,
      tiles: player.tiles,
      capital: player.capital,
      incomePerTick: Math.round(player.incomePerTick * 100) / 100,
      unlocks: player.unlocks,
      cooldowns: { ...player.cooldowns },
      allies: [...player.allies],
      wars: [...player.wars],
      pendingAllianceFrom: [...player.pendingAllianceFrom],
      transferSettings: { ...player.transferSettings },
      civilWarCooldown: player.civilWarCooldown,
      governmentCooldown: player.governmentCooldown,
      boostedTicks: player.boostedTicks,
      cities: player.cities,
      factories: player.factories,
      ports: player.ports,
      forts: player.forts,
      silos: player.silos,
      sams: player.sams,
      airports: player.airports,
      score: Math.round(player.score),
    };
  }

  // ---------------------------------------------------------------------
  // Tick pipeline
  // ---------------------------------------------------------------------

  /** Factory levels that are currently attached to a valid network. */
  private readonly factoryLevels = new Map<number, number>();
  /** Remaining life of stationary units (warships on station, ...). */
  private readonly unitTimers = new Map<number, number>();
  /** SAM cooldown per building id. */
  private readonly samCooldowns = new Map<number, number>();
  private readonly usedBotNames = new Set<string>();
  private lastSentBuildingsVersion = 0;

  /** Runs one simulation step and returns everything clients must know. */
  advance(): GameUpdate {
    this.tick++;
    this.spawnBotsIfNeeded();
    this.resolveMissiles();
    this.resolveBoats();
    this.resolveWarships();
    this.resolveTrade();
    this.resolveAviation();
    for (const player of this.allPlayers()) {
      if (!player.alive) continue;
      this.economyTick(player);
      this.coloniseTick(player);
      this.politicsTick(player);
    }
    this.eliminateDeadPlayers();
    this.autoTransfers();
    runBots(this);
    if (this.networksDirty && this.tick % Math.max(1, this.balance.networkRecomputeTicks) === 0) {
      this.recomputeNetworks();
    }
    this.decayScorch();
    this.decayCooldowns();
    this.refreshDiplomacyViews();
    return this.buildUpdate();
  }

  // --- AI nations ---------------------------------------------------------

  private spawnBotsIfNeeded(): void {
    if (this.tick < this.botSpawnAt) return;
    const alive = this.alivePlayers();
    const botCount = alive.filter((player) => player.isBot).length;
    const humanCount = alive.filter((player) => !player.isBot).length;
    const wanted = Math.max(0, Math.min(this.config.bots, this.config.maxPlayers - humanCount));
    if (botCount >= wanted) return;
    const preset = this.pickBotPreset();
    const government = GOVERNMENT_TYPES[this.rng.int(GOVERNMENT_TYPES.length)] ?? "democracy";
    this.addPlayer({
      name: preset.name,
      countryName: preset.name,
      flag: preset.flag,
      color: preset.color,
      government,
      isBot: true,
    });
  }

  private pickBotPreset(): { name: string; flag: string; color: string } {
    const available = COUNTRY_PRESETS.filter((preset) => !this.usedBotNames.has(preset.name));
    const pool = available.length > 0 ? available : COUNTRY_PRESETS;
    const preset = pool[this.rng.int(pool.length)] ?? COUNTRY_PRESETS[0]!;
    this.usedBotNames.add(preset.name);
    return { name: preset.name, flag: preset.flag, color: preset.color };
  }

  // --- Economy ------------------------------------------------------------

  private upkeepOf(playerId: number): number {
    let upkeep = 0;
    for (const type of Object.keys(BUILDINGS) as BuildingType[]) {
      const levels = this.buildings.levelSumOf(playerId, type);
      if (levels > 0) upkeep += levels * BUILDINGS[type].upkeep;
    }
    return upkeep;
  }

  private economyTick(player: PlayerInternal): void {
    const mods = modifiersOf(player.country.government);
    const counts = this.buildings.countsOf(player.id);
    const cityLevels = this.buildings.levelSumOf(player.id, "city");
    const happiness = player.country.happiness;

    player.cities = counts.city;
    player.factories = counts.factory;
    player.ports = counts.port;
    player.forts = counts.fort;
    player.silos = counts.missile_silo;
    player.sams = counts.sam_launcher;
    player.airports = counts.airport;
    player.unlocks = this.unlocked(player);

    const maxPopulation = maxPopulationOf(player.tiles, cityLevels, mods, this.balance);
    player.maxPopulation = maxPopulation;
    if (player.population > maxPopulation) {
      player.population = Math.max(maxPopulation, player.population * 0.995);
    } else {
      const happinessFactor = 0.7 + (happiness / 100) * 0.5;
      player.population +=
        (maxPopulation - player.population) * this.balance.popGrowth * mods.populationGrowthMultiplier * happinessFactor;
    }
    player.maxTroops = Math.round(maxPopulation * this.balance.troopsPerCitizen);
    if (player.troops < player.maxTroops) {
      player.troops = Math.min(
        player.maxTroops,
        player.troops +
          player.maxTroops * this.balance.troopRegen * moraleTroopFactor(happiness) * mods.productionMultiplier,
      );
    }

    const income = incomeBreakdown({
      tiles: player.tiles,
      population: player.population,
      cities: counts.city,
      factoryLevels: this.factoryLevels.get(player.id) ?? 0,
      ports: counts.port,
      airports: counts.airport,
      upkeep: this.upkeepOf(player.id),
      taxRate: player.taxRate,
      happiness,
      modifiers: mods,
      balance: this.balance,
    });
    player.money = Math.max(0, player.money + income.net);
    player.incomePerTick = income.net;
    player.score =
      player.tiles * 3 +
      player.population * 0.05 +
      player.troops +
      player.money * 0.02 +
      counts.city * 40 +
      counts.factory * 25 +
      counts.port * 35 +
      counts.airport * 30;
  }

  // --- Colonisation -------------------------------------------------------

  private coloniseTick(player: PlayerInternal): void {
    const mods = modifiersOf(player.country.government);
    const factor =
      mods.productionMultiplier *
      stabilityProductionFactor(player.country.discontent) *
      (0.85 + player.country.happiness / 250);
    const rate = Math.min(
      this.balance.colonizeMaxPerTick,
      (this.balance.colonizeBaseRate + player.tiles * this.balance.colonizeRatePerTile) * factor,
    );
    player.colonyCarry += rate;
    const wanted = Math.floor(player.colonyCarry);
    if (wanted <= 0) return;
    player.colonyCarry -= wanted;
    const seeds = this.frontierSeeds(player.id, Math.max(3, Math.min(12, wanted)));
    if (seeds.length === 0) return;
    const budget = Math.min(player.money * 0.6, wanted * this.balance.colonizeCost);
    if (budget < this.balance.colonizeCost) return;
    const wave = expandWave({
      index: this.index,
      terrain: this.map.terrain,
      origins: seeds,
      budget,
      costPerTile: () => this.balance.colonizeCost,
      canClaim: (tile, owner) => owner === 0 && this.map.terrain[tile] === LAND,
      maxTiles: wanted,
      scratch: this.scratch,
      onClaim: (tile) => this.setOwner(tile, player.id),
    });
    player.money = Math.max(0, player.money - wave.spent);
  }

  // --- Politics -----------------------------------------------------------

  private politicsTick(player: PlayerInternal): void {
    const mods = modifiersOf(player.country.government);
    const coverage = this.buildings.fortCoverage(player.id, player.tiles);
    const discontentBefore = player.country.discontent;
    const result = computeHappiness(
      { happiness: player.country.happiness, discontent: player.country.discontent },
      {
        modifiers: mods,
        balance: this.balance,
        taxRate: player.taxRate,
        wars: player.wars.length,
        recentLosses: player.recentLosses,
        tiles: player.tiles,
        fortCoverage: coverage,
        incomePerTick: player.incomePerTick,
        atCivilWarRisk: player.country.discontent > 80,
      },
    );
    player.country.happiness = result.happiness;
    player.country.discontent = result.discontent;
    player.recentLosses *= 0.94;

    if (
      civilWarPossible({
        discontent: Math.max(discontentBefore, player.country.discontent),
        cooldown: player.civilWarCooldown,
        tiles: player.tiles,
      })
    ) {
      this.triggerCivilWar(player);
    }
  }

  private triggerCivilWar(player: PlayerInternal): void {
    const protectedTiles = new Set(this.buildings.fortsOf(player.id));
    const maxTiles = Math.floor(player.tiles * this.balance.civilWarMaxTerritoryShare);
    const selection = selectSecessionTiles({
      index: this.index,
      terrain: this.map.terrain,
      playerId: player.id,
      capital: player.capital,
      maxTiles,
      protectedTiles,
      rng: this.rng,
    });
    if (selection.tiles.length < 6) {
      player.civilWarCooldown = 300;
      player.country.discontent = 78;
      return;
    }

    const id = this.players.length;
    const country: CountryData = {
      name: `${player.country.name} · rebelles`,
      flag: player.country.flag,
      color: shiftColor(player.country.color, 28, 0.06),
      government: "republic",
      happiness: 42,
      discontent: 52,
    };
    const rebel = createPlayer({
      id,
      name: `${player.country.name} · rebelles`,
      country,
      isBot: true,
      capital: selection.seed,
      tick: this.tick,
      balance: this.balance,
    });
    this.players.push(rebel);

    for (const tile of selection.tiles) {
      this.buildings.destroyOnTile(tile);
      this.setOwner(tile, id);
    }
    this.networksDirty = true;
    this.buildingsVersion++;

    const troopsShare = Math.min(player.troops * 0.45, player.troops - 10);
    if (troopsShare > 0) {
      player.troops -= troopsShare;
      rebel.troops = troopsShare;
      rebel.maxTroops = Math.max(60, Math.round(troopsShare * 1.3));
    }
    const moneyShare = player.money * 0.3;
    player.money -= moneyShare;
    rebel.money = moneyShare;
    const tilesShare = selection.tiles.length / Math.max(1, player.tiles + selection.tiles.length);
    const populationShare = player.population * Math.min(0.6, tilesShare * 1.15);
    player.population -= populationShare;
    rebel.population = populationShare;
    rebel.recentLosses = 0;
    rebel.nextThinkTick = this.tick + 40;

    this.setRelation(player.id, id, "civil_war");
    player.country.discontent = 45;
    player.country.happiness = Math.max(18, player.country.happiness - 18);
    player.civilWarCooldown = this.balance.civilWarCooldownTicks;
    this.refreshDiplomacyViews();

    this.events.emit({
      tick: this.tick,
      category: "civil_war",
      severity: 3,
      message: `🔥 Guerre civile : ${selection.tiles.length} cases font sécession de ${player.country.flag} ${player.country.name} et forment un nouveau régime !`,
      players: [player.id, id],
      icons: [player.country.flag],
      tile: selection.seed,
    });
  }

  private eliminateDeadPlayers(): void {
    for (const player of this.allPlayers()) {
      if (!player.alive) continue;
      if (player.tiles > 0) continue;
      player.alive = false;
      player.troops = 0;
      player.money = 0;
      player.population = 0;
      for (const other of this.allPlayers()) {
        if (other.id === player.id) continue;
        this.setRelation(player.id, other.id, "neutral");
      }
      this.events.emit({
        tick: this.tick,
        category: "war",
        severity: 3,
        message: `🏳️ ${player.country.flag} ${player.country.name} a été rayé de la carte.`,
        players: [player.id],
        icons: [player.country.flag],
      });
    }
  }

  private decayCooldowns(): void {
    for (const player of this.allPlayers()) {
      player.civilWarCooldown = Math.max(0, player.civilWarCooldown - 1);
      player.governmentCooldown = Math.max(0, player.governmentCooldown - 1);
      player.boostedTicks = Math.max(0, player.boostedTicks - 1);
      for (const kind of Object.keys(player.cooldowns) as StrategicKind[]) {
        player.cooldowns[kind] = Math.max(0, player.cooldowns[kind] - 1);
      }
    }
    for (const [id, value] of this.samCooldowns) {
      if (value <= 1) this.samCooldowns.delete(id);
      else this.samCooldowns.set(id, value - 1);
    }
  }

  // --- Networks -----------------------------------------------------------

  private recomputeNetworks(): void {
    const refs: Array<{ id: number; type: BuildingType; tile: number; ownerId: number }> = [];
    for (const building of this.buildings.buildings.values()) {
      refs.push({
        id: building.id,
        type: building.type,
        tile: building.tile,
        ownerId: building.ownerId,
      });
    }
    const result = computeTransportNetworks({
      width: this.map.width,
      height: this.map.height,
      road: this.buildings.road,
      buildings: refs,
    });
    this.factoryLevels.clear();
    for (const building of this.buildings.buildings.values()) {
      if (building.type === "road") {
        building.connected = true;
        continue;
      }
      building.connected = result.connected.has(building.id);
      if (building.connected && building.type === "factory") {
        this.factoryLevels.set(
          building.ownerId,
          (this.factoryLevels.get(building.ownerId) ?? 0) + building.level,
        );
      }
    }
    this.networksDirty = false;
  }

  // --- Strategic weapons --------------------------------------------------

  private addScorch(tile: number, severity: number): void {
    const existing = this.scorch.get(tile);
    this.scorch.set(tile, {
      ticks: this.balance.scorchTicks,
      severity: Math.max(severity, existing?.severity ?? 0),
    });
  }

  private decayScorch(): void {
    if (this.tick % 10 !== 0) return;
    for (const [tile, entry] of this.scorch) {
      entry.ticks -= 10;
      if (entry.ticks <= 0) this.scorch.delete(tile);
    }
  }

  private samIsReady(buildingId: number): boolean {
    return (this.samCooldowns.get(buildingId) ?? 0) <= 0;
  }

  private resolveMissiles(): void {
    if (this.missiles.length === 0) return;
    const remaining: MissileData[] = [];
    for (const missile of this.missiles) {
      const spec = STRATEGIC_WEAPONS[missile.kind];
      missile.ticksToImpact -= 1;
      missile.progress = Math.min(1, Math.max(0, 1 - missile.ticksToImpact / Math.max(1, spec.flightTicks)));
      if (missile.ticksToImpact > 0) {
        remaining.push(missile);
        continue;
      }
      this.detonateMissile(missile);
    }
    this.missiles = remaining;
  }

  private detonateMissile(missile: MissileData): void {
    const spec = STRATEGIC_WEAPONS[missile.kind];
    const width = this.map.width;
    const target = idxOf(width, missile.toX, missile.toY);
    const attacker = this.get(missile.ownerId);

    const candidates: Array<{ level: number; distance: number; radius: number; ready: boolean }> = [];
    for (const player of this.alivePlayers()) {
      if (player.id === missile.ownerId) continue;
      for (const sam of this.buildings.samsOf(player.id)) {
        if (sam.buildRemaining > 0) continue;
        const sx = sam.tile % width;
        const sy = (sam.tile - sx) / width;
        const distance = Math.hypot(missile.toX - sx, missile.toY - sy);
        const radius =
          this.balance.samRadiusBase + (sam.level - 1) * this.balance.samRadiusPerLevel;
        if (distance > radius) continue;
        const ready = this.samIsReady(sam.id);
        candidates.push({ level: sam.level, distance, radius, ready });
        if (ready) this.samCooldowns.set(sam.id, this.balance.samCooldownTicks);
      }
    }
    const chance = interceptionProbability(candidates, spec.baseInterception);
    if (candidates.length > 0 && this.rng.chance(chance)) {
      this.addScorch(target, 0.35);
      this.events.emit({
        tick: this.tick,
        category: "military",
        severity: 3,
        message: `📡 Un ${spec.label.toLowerCase()} de ${attacker?.country.name ?? "?"} a été intercepté par les défenses antimissiles.`,
        players: [missile.ownerId],
        tile: target,
      });
      return;
    }

    const tiles = blastTiles(target, spec.radius, width, this.map.height);
    const affected = new Map<number, number>();
    const destroyed: BuildingData[] = [];
    for (const tile of tiles) {
      const tx = tile % width;
      const ty = (tile - tx) / width;
      const strength = blastStrength(tx - missile.toX, ty - missile.toY, spec.radius);
      this.addScorch(tile, strength);
      const owner = this.index.ownerOf(tile);
      if (owner === 0) continue;
      if (strength > (affected.get(owner) ?? 0)) affected.set(owner, strength);
      const building = this.buildings.at(tile);
      if (building && building.ownerId !== missile.ownerId) {
        const gone = this.buildings.damage(building.id, spec.buildingDamage * (0.4 + strength));
        if (gone) destroyed.push(building);
      }
    }
    if (destroyed.length > 0) {
      this.networksDirty = true;
      this.buildingsVersion++;
    }

    for (const [ownerId, strength] of affected) {
      const player = this.get(ownerId);
      if (!player || !player.alive) continue;
      const troopLoss = Math.min(player.troops, spec.troopDamage * strength);
      player.troops -= troopLoss;
      const populationLoss = Math.min(player.population, spec.populationDamage * strength);
      player.population -= populationLoss;
      player.recentLosses += troopLoss * 2;
      if (ownerId !== missile.ownerId) this.setRelation(missile.ownerId, ownerId, "war");
      this.events.emit({
        tick: this.tick,
        category: "military",
        severity: ownerId === missile.ownerId ? 2 : 3,
        message: `${spec.icon} Frappe ${spec.label.toLowerCase()} de ${attacker?.country.flag ?? ""} ${attacker?.country.name ?? "?"} sur ${player.country.flag} ${player.country.name} : ${Math.round(troopLoss)} troupes et ${Math.round(populationLoss)} civils perdus.`,
        players: [missile.ownerId, ownerId],
        tile: target,
      });
    }
    this.refreshDiplomacyViews();
  }

  // --- Naval --------------------------------------------------------------

  private resolveBoats(): void {
    if (this.boats.length === 0) return;
    const remaining: BoatData[] = [];
    for (const boat of this.boats) {
      const owner = this.get(boat.ownerId);
      if (!owner || !owner.alive || boat.hp <= 0) continue;
      if (boat.progress < 1) {
        const dx = boat.toX - boat.fromX;
        const dy = boat.toY - boat.fromY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const speed = boat.kind === "warship" ? this.balance.warshipSpeed : this.balance.boatSpeed;
        boat.progress = Math.min(1, boat.progress + speed / distance);
        boat.x = boat.fromX + dx * boat.progress;
        boat.y = boat.fromY + dy * boat.progress;
        if (boat.progress < 1) {
          remaining.push(boat);
          continue;
        }
        if (boat.kind === "transport") {
          this.landTroops(boat);
          continue;
        }
        this.unitTimers.set(boat.id, 600);
      }
      const timer = (this.unitTimers.get(boat.id) ?? 0) - 1;
      if (timer <= 0) continue;
      this.unitTimers.set(boat.id, timer);
      remaining.push(boat);
    }
    this.boats = remaining;
  }

  private landTroops(boat: BoatData): void {
    const player = this.get(boat.ownerId);
    if (!player || !player.alive) return;
    const width = this.map.width;
    const target = idxOf(width, Math.round(boat.toX), Math.round(boat.toY));
    const defenderId = this.index.ownerOf(target);
    if (defenderId === boat.ownerId || (defenderId !== 0 && this.relationBetween(boat.ownerId, defenderId) === "ally")) {
      player.troops = Math.min(player.maxTroops * 1.2, player.troops + boat.troops);
      return;
    }
    const defender = defenderId !== 0 ? this.get(defenderId) : undefined;
    const forts = defender ? this.buildings.fortsOf(defenderId) : [];
    const cost = this.balance.landingCostPerTile;
    let spent = 0;
    let captured = 0;
    const canClaim = (tile: number, owner: number): boolean =>
      owner === defenderId && this.map.terrain[tile] === LAND && tile >= 0;

    if (canClaim(target, defenderId) && boat.troops >= cost) {
      this.buildings.destroyOnTile(target);
      this.setOwner(target, boat.ownerId);
      spent += cost;
      captured++;
    }
    const wave = expandWave({
      index: this.index,
      terrain: this.map.terrain,
      origins: [target],
      budget: Math.max(0, boat.troops - spent),
      costPerTile: (tile) => cost * this.buildings.defenseMultiplierAt(tile, forts, width),
      canClaim,
      maxTiles: 70,
      scratch: this.scratch,
      onClaim: (tile) => {
        this.buildings.destroyOnTile(tile);
        this.setOwner(tile, boat.ownerId);
      },
    });
    spent += wave.spent;
    captured += wave.claimed.length;
    player.troops = Math.min(player.maxTroops * 1.2, player.troops + Math.max(0, boat.troops - spent));
    this.networksDirty = true;

    if (defender) {
      const losses = Math.min(defender.troops, captured * 2.2);
      defender.troops = Math.max(0, defender.troops - losses);
      defender.recentLosses += losses;
      this.setRelation(boat.ownerId, defenderId, "war");
    }
    if (captured > 0) {
      this.events.emit({
        tick: this.tick,
        category: "military",
        severity: captured > 25 ? 3 : 2,
        message: `⛵ Débarquement de ${player.country.flag} ${player.country.name}${defender ? ` sur ${defender.country.name}` : " sur une côte libre"} : ${captured} case(s).`,
        players: defender ? [boat.ownerId, defenderId] : [boat.ownerId],
        tile: target,
        dedupeKey: `landing:${boat.ownerId}:${defenderId}`,
      });
    }
  }

  private resolveWarships(): void {
    const warships = this.boats.filter((boat) => boat.kind === "warship" && boat.progress >= 1);
    if (warships.length === 0) return;
    for (const warship of warships) {
      const width = this.map.width;
      const sx = warship.x;
      const sy = warship.y;
      let target: { hp: number; x: number; y: number; ownerId: number; kind: string; id: number } | null =
        null;
      let bestDistance = 5;
      for (const ship of this.tradeShips) {
        if (ship.ownerId === warship.ownerId) continue;
        if (this.relationBetween(warship.ownerId, ship.ownerId) === "ally") continue;
        const distance = Math.hypot(ship.x - sx, ship.y - sy);
        if (distance <= bestDistance) {
          bestDistance = distance;
          target = { hp: 60, x: ship.x, y: ship.y, ownerId: ship.ownerId, kind: "trade", id: ship.id };
        }
      }
      for (const boat of this.boats) {
        if (boat.id === warship.id || boat.ownerId === warship.ownerId) continue;
        if (this.relationBetween(warship.ownerId, boat.ownerId) === "ally") continue;
        const distance = Math.hypot(boat.x - sx, boat.y - sy);
        if (distance <= bestDistance) {
          bestDistance = distance;
          target = { hp: boat.hp, x: boat.x, y: boat.y, ownerId: boat.ownerId, kind: "boat", id: boat.id };
        }
      }
      if (!target) continue;
      if (target.kind === "trade") {
        this.tradeShips = this.tradeShips.filter((ship) => ship.id !== target!.id);
      } else {
        const boat = this.boats.find((candidate) => candidate.id === target!.id);
        if (boat) boat.hp -= 55;
      }
      const attacker = this.get(warship.ownerId);
      const victim = this.get(target.ownerId);
      this.events.emit({
        tick: this.tick,
        category: "military",
        severity: 1,
        message: `🚢 Un bateau de guerre de ${attacker?.country.name ?? "?"} coule une unité de ${victim?.country.name ?? "?"}.`,
        players: [warship.ownerId, target.ownerId],
        tile: idxOf(width, Math.round(target.x), Math.round(target.y)),
        dedupeKey: `warship:${warship.ownerId}:${target.ownerId}`,
      });
    }
  }

  // --- Trade and aviation -------------------------------------------------

  private portsOf(playerId: number): BuildingData[] {
    return this.buildings
      .listOf(playerId)
      .filter((building) => building.type === "port" && building.buildRemaining <= 0)
      .sort((a, b) => a.id - b.id);
  }

  private airportsOf(playerId: number): BuildingData[] {
    return this.buildings
      .listOf(playerId)
      .filter((building) => building.type === "airport" && building.buildRemaining <= 0)
      .sort((a, b) => a.id - b.id);
  }

  private resolveTrade(): void {
    const width = this.map.width;
    const height = this.map.height;

    if (this.tick % 30 === 0 && this.tradeShips.length < 160) {
      for (const player of this.alivePlayers()) {
        for (const port of this.portsOf(player.id)) {
          if (!this.rng.chance(0.5)) continue;
          const partners = this.alivePlayers().filter(
            (candidate) =>
              candidate.id === player.id ||
              this.relationBetween(player.id, candidate.id) === "ally",
          );
          const targets: BuildingData[] = [];
          for (const partner of partners) {
            for (const other of this.portsOf(partner.id)) {
              if (other.id === port.id) continue;
              targets.push(other);
            }
          }
          if (targets.length === 0) continue;
          const destination = targets[this.rng.int(targets.length)]!;
          const ox = port.tile % width;
          const oy = (port.tile - ox) / width;
          const tx = destination.tile % width;
          const ty = (destination.tile - tx) / width;
          if (!waterLineClear(this.map.terrain, width, height, ox, oy, tx, ty)) continue;
          this.tradeShips.push({
            id: this.nextUnitId++,
            ownerId: player.id,
            x: ox,
            y: oy,
            toX: tx,
            toY: ty,
            progress: 0,
            value: this.balance.tradeShipValue * (1 + (port.level - 1) * 0.25),
          });
        }
      }
    }

    if (this.tradeShips.length === 0) return;
    const remaining: TradeShipData[] = [];
    for (const ship of this.tradeShips) {
      const owner = this.get(ship.ownerId);
      if (!owner || !owner.alive) continue;
      const dx = ship.toX - ship.x;
      const dy = ship.toY - ship.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      ship.progress += this.balance.tradeShipSpeed / distance;
      if (ship.progress < 1) {
        ship.x += dx * Math.min(1, this.balance.tradeShipSpeed / distance);
        ship.y += dy * Math.min(1, this.balance.tradeShipSpeed / distance);
        remaining.push(ship);
        continue;
      }
      owner.money += ship.value;
      this.commerceIncome.set(ship.ownerId, (this.commerceIncome.get(ship.ownerId) ?? 0) + ship.value);
      this.events.emit({
        tick: this.tick,
        category: "economy",
        severity: 1,
        message: `🚚 Une route commerciale de ${owner.country.flag} ${owner.country.name} rapporte ${Math.round(ship.value)} $.`,
        players: [ship.ownerId],
        dedupeKey: `trade:${ship.ownerId}`,
      });
    }
    this.tradeShips = remaining;
  }

  private resolveAviation(): void {
    if (this.tick % 45 === 0 && this.planes.length < 90) {
      for (const player of this.alivePlayers()) {
        for (const airport of this.airportsOf(player.id)) {
          if (!this.rng.chance(0.6)) continue;
          const partners = this.alivePlayers().filter(
            (candidate) =>
              candidate.id === player.id || this.relationBetween(player.id, candidate.id) === "ally",
          );
          const targets: BuildingData[] = [];
          for (const partner of partners) {
            for (const other of this.airportsOf(partner.id)) {
              if (other.id === airport.id) continue;
              targets.push(other);
            }
          }
          if (targets.length === 0) continue;
          const destination = targets[this.rng.int(targets.length)]!;
          const width = this.map.width;
          this.planes.push({
            id: this.nextUnitId++,
            ownerId: player.id,
            kind: "trade",
            x: airport.tile % width,
            y: (airport.tile - (airport.tile % width)) / width,
            toX: destination.tile % width,
            toY: (destination.tile - (destination.tile % width)) / width,
            progress: 0,
            value: this.balance.planeTradeValue * (1 + (airport.level - 1) * 0.2),
          });
        }
      }
    }

    if (this.tick % 60 === 0) {
      for (const player of this.alivePlayers()) {
        for (const airport of this.airportsOf(player.id)) {
          const width = this.map.width;
          const ax = airport.tile % width;
          const ay = (airport.tile - ax) / width;
          const enemies = this.boats.filter(
            (boat) =>
              boat.ownerId !== player.id &&
              this.relationBetween(player.id, boat.ownerId) !== "ally" &&
              Math.hypot(boat.x - ax, boat.y - ay) < 30,
          );
          if (enemies.length === 0) continue;
          const target = enemies[0]!;
          this.planes.push({
            id: this.nextUnitId++,
            ownerId: player.id,
            kind: "fighter",
            x: ax,
            y: ay,
            toX: target.x,
            toY: target.y,
            progress: 0,
            value: 0,
          });
        }
      }
    }

    if (this.planes.length === 0) return;
    const remaining: PlaneData[] = [];
    for (const plane of this.planes) {
      const owner = this.get(plane.ownerId);
      if (!owner || !owner.alive) continue;
      const dx = plane.toX - plane.x;
      const dy = plane.toY - plane.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const step = this.balance.planeSpeed / distance;
      plane.progress += step;
      if (plane.progress < 1) {
        plane.x += dx * step;
        plane.y += dy * step;
        remaining.push(plane);
        continue;
      }
      if (plane.kind === "trade") {
        owner.money += plane.value;
        this.commerceIncome.set(plane.ownerId, (this.commerceIncome.get(plane.ownerId) ?? 0) + plane.value);
      } else {
        // Fighter: damage the closest enemy boat around the arrival point.
        let best: BoatData | undefined;
        let bestDistance = 6;
        for (const boat of this.boats) {
          if (boat.ownerId === plane.ownerId) continue;
          const d = Math.hypot(boat.x - plane.toX, boat.y - plane.toY);
          if (d <= bestDistance) {
            bestDistance = d;
            best = boat;
          }
        }
        if (best) {
          best.hp -= 70;
          this.events.emit({
            tick: this.tick,
            category: "military",
            severity: 1,
            message: `✈️ Un avion de chasse de ${owner.country.name} frappe une unité navale.`,
            players: [plane.ownerId, best.ownerId],
            dedupeKey: `fighter:${plane.ownerId}`,
          });
        }
      }
    }
    this.planes = remaining;
  }

  // --- Alliances ----------------------------------------------------------

  private autoTransfers(): void {
    if (this.tick % 20 !== 0) return;
    for (const alliance of this.alliances.values()) {
      if (!alliance.active) continue;
      for (const memberId of alliance.members) {
        const member = this.get(memberId);
        if (!member || !member.alive) continue;
        const settings = member.transferSettings;
        if (!settings.allowAutoTransfers) continue;
        const target = alliance.members.find((id) => id !== memberId);
        if (target === undefined) continue;
        const ally = this.get(target);
        if (!ally || !ally.alive) continue;
        if (settings.moneyPercentage > 0) {
          const amount = member.money * (settings.moneyPercentage / 100) * 0.08;
          if (amount > 1) {
            member.money -= amount;
            ally.money += amount;
          }
        }
        if (settings.troopPercentage > 0) {
          const amount = member.troops * (settings.troopPercentage / 100) * 0.08;
          if (amount > 1) {
            member.troops -= amount;
            ally.troops = Math.min(ally.maxTroops * 1.2, ally.troops + amount);
          }
        }
      }
    }
  }

  // --- Update -------------------------------------------------------------

  private buildUpdate(): GameUpdate {
    const idx: number[] = [];
    const owner: number[] = [];
    for (const tile of this.dirtyTiles) {
      idx.push(tile);
      owner.push(this.index.ownerOf(tile));
    }
    this.dirtyTiles.clear();

    const players: PlayerState[] = [];
    for (const player of this.allPlayers()) {
      const state = this.playerState(player);
      if (state) players.push(state);
    }

    const buildings =
      this.buildingsVersion !== this.lastSentBuildingsVersion
        ? Array.from(this.buildings.buildings.values()).map((building) => ({ ...building }))
        : [];
    this.lastSentBuildingsVersion = this.buildingsVersion;

    return {
      tick: this.tick,
      players,
      buildings,
      buildingsVersion: this.buildingsVersion,
      boats: this.boats.map((boat) => ({ ...boat })),
      tradeShips: this.tradeShips.map((ship) => ({ ...ship })),
      planes: this.planes.map((plane) => ({ ...plane })),
      missiles: this.missiles.map((missile) => ({ ...missile })),
      alliances: this.getAlliances(),
      relations: this.getRelations(),
      requests: [...this.requests],
      tileChanges: { idx, owner },
      scorch: Array.from(this.scorch.keys()),
      events: this.events.drain(),
      notifications: this.events.drainNotifications(),
    };
  }

  /** Full state for a client that just joined. */
  snapshot(): GameSnapshot {
    const players: PlayerState[] = [];
    for (const player of this.allPlayers()) {
      const state = this.playerState(player);
      if (state) players.push(state);
    }
    const buildings: BuildingData[] = Array.from(this.buildings.buildings.values());
    const relations: DiplomacyRelation[] = [];
    for (const [key, kind] of this.relations) {
      const [aText, bText] = key.split(":");
      const a = Number(aText);
      const b = Number(bText);
      relations.push({ a, b, kind });
    }
    return {
      tick: this.tick,
      config: this.config,
      map: this.info,
      players,
      buildings,
      boats: this.boats,
      tradeShips: this.tradeShips,
      planes: this.planes,
      missiles: this.missiles,
      alliances: Array.from(this.alliances.values()),
      relations,
      requests: this.requests,
      events: this.events.recent(60),
      terrain: encodeBytes(this.map.terrain),
      owner: encodeBytes(Uint8Array.from(this.index.owner, (value) => value)),
      scorch: Array.from(this.scorch.keys()),
      tickIntervalMs: Math.round(1000 / this.config.tickRate),
    };
  }

  /** Terrain helper used by tests. */
  terrainAt(x: number, y: number): number {
    const tile = this.tileAt(x, y);
    return tile === -1 ? -1 : this.map.terrain[tile]!;
  }

  /** Hands a nation over to the AI (when a player disconnects). */
  setController(playerId: number, isBot: boolean): void {
    const player = this.get(playerId);
    if (!player) return;
    player.isBot = isBot;
    player.nextThinkTick = this.tick + 20;
  }

  /** Ownership change used by systems, admin tools and tests. */
  setTileOwner(tile: number, playerId: number): void {
    if (tile < 0 || tile >= this.map.terrain.length) return;
    this.setOwner(tile, playerId);
  }

  ownerAt(x: number, y: number): number {
    const tile = this.tileAt(x, y);
    return tile === -1 ? -1 : this.index.ownerOf(tile);
  }

  /** Accessors used by subsystems and tests. */
  getRng(): Rng {
    return this.rng;
  }

  getEvents(): EventLog {
    return this.events;
  }

  getBoats(): readonly BoatData[] {
    return this.boats;
  }

  getMissiles(): readonly MissileData[] {
    return this.missiles;
  }

  getTradeShips(): readonly TradeShipData[] {
    return this.tradeShips;
  }

  getPlanes(): readonly PlaneData[] {
    return this.planes;
  }

  getAlliances(): AllianceData[] {
    return Array.from(this.alliances.values());
  }

  getRelations(): DiplomacyRelation[] {
    return Array.from(this.relations.entries()).map(([key, kind]) => {
      const [aText, bText] = key.split(":");
      return { a: Number(aText), b: Number(bText), kind };
    });
  }

  getRequests(): AllianceRequest[] {
    return this.requests;
  }

  isWaterAt(tile: number): boolean {
    return isWater(this.map.terrain[tile]!);
  }

  static eventSummary(events: readonly WorldEvent[]): string {
    return events.map((event) => event.message).join("\n");
  }
}

function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is a global in browsers and in Node >= 16.
  return btoa(binary);
}
