/**
 * Civil war secession.
 *
 * When discontent reaches 100 %, a contiguous part of the nation breaks away.
 * The selection is engine-side and deterministic:
 *  - the seed is the owned tile farthest from the capital (the periphery);
 *  - the wave grows away from the capital through the rebel nation's tiles;
 *  - fort tiles are excluded and act as barriers, so a well fortified nation
 *    keeps its strategic assets;
 *  - the size of the secession is bounded by `civilWarMaxTerritoryShare`.
 */

import type { Rng } from "../rng";
import { tileDistance } from "../map/grid";
import type { TerritoryIndex } from "./propagation";

export interface SecessionOptions {
  index: TerritoryIndex;
  terrain: Uint8Array;
  playerId: number;
  capital: number;
  maxTiles: number;
  /** Tiles protected by a fort: they cannot secede and they block the wave. */
  protectedTiles: ReadonlySet<number>;
  rng: Rng;
}

export interface SecessionResult {
  tiles: number[];
  seed: number;
}

export function selectSecessionTiles(options: SecessionOptions): SecessionResult {
  const { index, terrain, playerId, capital, maxTiles, protectedTiles, rng } = options;
  const width = index.width;
  const height = index.height;
  const owner = index.owner;

  const owned: number[] = [];
  for (let tile = 0; tile < owner.length; tile++) {
    if (owner[tile] === playerId) owned.push(tile);
  }
  if (owned.length < 8) return { tiles: [], seed: -1 };

  // Candidate seeds: the farthest tiles from the capital, sampled a few times
  // so that secessions do not always start in the same corner of a nation.
  owned.sort((a, b) => tileDistance(width, b, capital) - tileDistance(width, a, capital));
  const candidateCount = Math.min(owned.length, 12);
  const pool = owned.slice(0, candidateCount);
  const seed = pool[Math.min(pool.length - 1, rng.int(pool.length))]!;

  const visited = new Uint8Array(owner.length);
  const queue: number[] = [seed];
  visited[seed] = 1;
  const tiles: number[] = [];
  const capitalDistance = tileDistance(width, seed, capital);

  for (let head = 0; head < queue.length && tiles.length < maxTiles; head++) {
    const tile = queue[head]!;
    if (protectedTiles.has(tile)) continue;
    if (owner[tile] !== playerId) continue;
    tiles.push(tile);
    const x = tile % width;
    const y = (tile - x) / width;
    const neighbors = [
      x + 1 < width ? tile + 1 : -1,
      x - 1 >= 0 ? tile - 1 : -1,
      y + 1 < height ? tile + width : -1,
      y - 1 >= 0 ? tile - width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor] === 1) continue;
      if (owner[neighbor] !== playerId) continue;
      if (terrain[neighbor] !== 1) continue;
      // Never grow back towards the capital: the rebels take the periphery.
      if (tileDistance(width, neighbor, capital) < capitalDistance) continue;
      visited[neighbor] = 1;
      queue.push(neighbor);
    }
  }

  if (tiles.length < 6) return { tiles: [], seed: -1 };
  return { tiles, seed };
}
