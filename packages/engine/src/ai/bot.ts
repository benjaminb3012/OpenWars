/**
 * AI nations.
 *
 * Bots use exactly the same validated entry points as human players
 * (`tryBuild`, `tryAttack`, `tryRequestAlliance`, ...). They never touch the
 * simulation state directly, which keeps the rules identical for everybody and
 * keeps the simulation deterministic (all randomness comes from the game seed).
 */

import { BUILDINGS, type BuildingType } from "@openwars/shared";
import { LAND } from "../map/grid";
import type { GameImpl } from "../game/GameImpl";
import type { PlayerInternal } from "../game/player";

export function runBots(game: GameImpl): void {
  for (const player of game.alivePlayers()) {
    if (!player.isBot) continue;
    if (game.tick < player.nextThinkTick) continue;
    player.nextThinkTick = game.tick + game.balance.botThinkTicks;
    think(game, player);
  }
}

function think(game: GameImpl, player: PlayerInternal): void {
  const rng = game.getRng();
  buildPhase(game, player, rng);
  roadPhase(game, player);
  militaryPhase(game, player, rng);
  diplomacyPhase(game, player, rng);
}

function buildPhase(game: GameImpl, player: PlayerInternal, rng: { chance(p: number): boolean; int(n: number): number }): void {
  const counts = game.buildings.countsOf(player.id);
  const budget = player.money;
  const plan: BuildingType[] = [];

  if (budget > BUILDINGS.city.cost && counts.city <= counts.factory * 2 + 1) plan.push("city");
  if (budget > BUILDINGS.factory.cost * 1.4 && counts.factory < counts.city * 2) plan.push("factory");
  if (budget > BUILDINGS.port.cost * 1.6 && counts.port < 2) plan.push("port");
  if (budget > BUILDINGS.fort.cost * 1.8 && counts.fort < 3) plan.push("fort");
  if (budget > BUILDINGS.sam_launcher.cost * 2 && counts.sam_launcher < 2) plan.push("sam_launcher");
  if (budget > BUILDINGS.missile_silo.cost * 2.2 && counts.missile_silo < 1) plan.push("missile_silo");
  if (budget > BUILDINGS.airport.cost * 2 && counts.airport < 1) plan.push("airport");

  if (plan.length === 0) return;
  if (!rng.chance(0.45)) return;
  const type = plan[rng.int(plan.length)]!;
  const tile = findBuildingSpot(game, player, type, rng);
  if (tile === -1) return;
  game.tryBuild(player.id, type === "city" ? "city" : type, tile % game.map.width, Math.floor(tile / game.map.width));
}

function findBuildingSpot(
  game: GameImpl,
  player: PlayerInternal,
  type: BuildingType,
  rng: { int(n: number): number },
): number {
  const width = game.map.width;
  const capitalX = player.capital % width;
  const capitalY = Math.floor(player.capital / width);
  const candidates: number[] = [];
  const radius = 14;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = capitalY + dy;
    if (y < 0 || y >= game.map.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = capitalX + dx;
      if (x < 0 || x >= width) continue;
      const tile = y * width + x;
      if (game.map.terrain[tile] !== LAND) continue;
      if (game.buildings.canPlace(player.id, type, tile).ok) candidates.push(tile);
    }
  }
  if (candidates.length === 0) return -1;
  return candidates[rng.int(candidates.length)]!;
}

/** Connects factories and airports to the nearest city with a road. */
function roadPhase(game: GameImpl, player: PlayerInternal): void {
  if (player.money < 200) return;
  const buildings = game.buildings.listOf(player.id);
  const cities = buildings.filter((building) => building.type === "city");
  if (cities.length === 0) return;
  const orphans = buildings.filter(
    (building) =>
      (building.type === "factory" || building.type === "airport") &&
      !building.connected &&
      building.buildRemaining <= 0,
  );
  if (orphans.length === 0) return;
  const orphan = orphans[0]!;
  let best = cities[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const city of cities) {
    const distance = Math.abs(city.tile - orphan.tile);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = city;
    }
  }
  game.tryBuildRoadPath(player.id, orphan.tile, best.tile);
}

function militaryPhase(
  game: GameImpl,
  player: PlayerInternal,
  rng: { chance(p: number): boolean; int(n: number): number },
): void {
  // Strategic strike when a silo is available and the nation is rich.
  const silos = game.buildings.listOf(player.id).filter((building) => building.type === "missile_silo");
  if (silos.length > 0 && player.money > 1800 && player.cooldowns.missile === 0 && rng.chance(0.25)) {
    const enemies = game
      .alivePlayers()
      .filter((other) => other.id !== player.id && game.relationBetween(player.id, other.id) === "war")
      .sort((a, b) => b.tiles - a.tiles);
    const target = enemies[0];
    if (target) {
      const x = target.capital % game.map.width;
      const y = Math.floor(target.capital / game.map.width);
      game.tryLaunchMissile(player.id, "missile", x, y);
    }
  }

  if (player.troops < player.maxTroops * 0.6) return;
  if (!rng.chance(0.5)) return;
  const target = findAttackTarget(game, player);
  if (target === -1) return;
  const x = target % game.map.width;
  const y = Math.floor(target / game.map.width);
  game.tryAttack(player.id, x, y);
}

/** Nearest tile owned by a non-ally nation within a radius of the capital. */
function findAttackTarget(game: GameImpl, player: PlayerInternal): number {
  const width = game.map.width;
  const capitalX = player.capital % width;
  const capitalY = Math.floor(player.capital / width);
  for (let radius = 2; radius <= 45; radius += 2) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = capitalY + dy;
      if (y < 0 || y >= game.map.height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = capitalX + dx;
        if (x < 0 || x >= width) continue;
        const tile = y * width + x;
        const owner = game.index.ownerOf(tile);
        if (owner === 0 || owner === player.id) continue;
        if (game.relationBetween(player.id, owner) === "ally") continue;
        const other = game.get(owner);
        if (!other || !other.alive) continue;
        const score = other.troops + other.tiles * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = tile;
        }
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

function diplomacyPhase(
  game: GameImpl,
  player: PlayerInternal,
  rng: { chance(p: number): boolean; int(n: number): number },
): void {
  for (const from of player.pendingAllianceFrom) {
    const suitor = game.get(from);
    if (!suitor) continue;
    if (suitor.tiles > player.tiles * 1.2 || rng.chance(0.35)) {
      game.tryRespondAlliance(player.id, from, true);
      return;
    }
  }
  if (!rng.chance(0.12)) return;
  if (game.allianceOf(player.id)) return;
  const neighbours = game
    .alivePlayers()
    .filter(
      (other) =>
        other.id !== player.id &&
        game.relationBetween(player.id, other.id) !== "ally" &&
        game.relationBetween(player.id, other.id) !== "war",
    )
    .sort((a, b) => b.tiles - a.tiles);
  const partner = neighbours[0];
  if (partner && partner.tiles > player.tiles * 2) {
    game.tryRequestAlliance(player.id, partner.id);
  }
}
