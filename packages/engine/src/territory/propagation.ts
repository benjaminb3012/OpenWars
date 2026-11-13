/**
 * Territorial propagation.
 *
 * The old (naive) approach was a global loop over random unclaimed tiles, which
 * is what made expansion look random and disconnected. Here, every territorial
 * change goes through `TerritoryIndex` and `expandWave`:
 *
 *  - ownership is a per-tile array, exactly like OpenFrontIO;
 *  - a wave is a breadth-first traversal that can only claim tiles *adjacent*
 *    to the growing frontier, so territories are always connected to the
 *    nation that claims them;
 *  - neighbours are visited in a fixed order and the queue is an Int32Array,
 *    so a wave is fully deterministic and allocation-free;
 *  - the frontier of each player is maintained incrementally, so colonisation
 *    costs O(frontier) instead of O(map).
 *
 * See docs/TERRITORY.md for the design notes and the rationale.
 */

import { LAND } from "../map/grid";

export class TerritoryIndex {
  readonly width: number;
  readonly height: number;
  readonly owner: Uint16Array;
  private readonly counts = new Map<number, number>();
  private readonly frontier = new Map<number, Set<number>>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.owner = new Uint16Array(width * height);
  }

  ownerOf(tile: number): number {
    return this.owner[tile]!;
  }

  count(playerId: number): number {
    return this.counts.get(playerId) ?? 0;
  }

  totalOwned(): number {
    let total = 0;
    for (const value of this.counts.values()) total += value;
    return total;
  }

  /** Unclaimed tiles adjacent to the player's territory (insertion order). */
  frontierOf(playerId: number): ReadonlySet<number> {
    return this.frontier.get(playerId) ?? EMPTY_SET;
  }

  /** Tiles owned by `playerId` adjacent to a tile owned by somebody else. */
  isBorderTile(tile: number, playerId: number): boolean {
    const width = this.width;
    const height = this.height;
    const x = tile % width;
    const y = (tile - x) / width;
    if (x + 1 < width) {
      const owner = this.owner[tile + 1]!;
      if (owner !== playerId) return true;
    }
    if (x - 1 >= 0) {
      const owner = this.owner[tile - 1]!;
      if (owner !== playerId) return true;
    }
    if (y + 1 < height) {
      const owner = this.owner[tile + width]!;
      if (owner !== playerId) return true;
    }
    if (y - 1 >= 0) {
      const owner = this.owner[tile - width]!;
      if (owner !== playerId) return true;
    }
    return false;
  }

  /** Applies an ownership change and keeps counts/frontiers consistent. */
  setOwner(tile: number, newOwner: number): void {
    const previous = this.owner[tile]!;
    if (previous === newOwner) return;

    if (previous !== 0) {
      this.counts.set(previous, (this.counts.get(previous) ?? 0) - 1);
    }
    this.owner[tile] = newOwner;
    if (newOwner !== 0) {
      this.counts.set(newOwner, (this.counts.get(newOwner) ?? 0) + 1);
      this.frontierFor(newOwner).delete(tile);
    }

    const width = this.width;
    const height = this.height;
    const x = tile % width;
    const y = (tile - x) / width;

    const visit = (neighbor: number): void => {
      const neighborOwner = this.owner[neighbor]!;
      if (neighborOwner === 0) {
        if (newOwner !== 0) this.frontierFor(newOwner).add(neighbor);
        if (previous !== 0 && !this.hasOwnedNeighbor(neighbor, previous)) {
          this.frontierFor(previous).delete(neighbor);
        }
      }
    };

    if (x + 1 < width) visit(tile + 1);
    if (x - 1 >= 0) visit(tile - 1);
    if (y + 1 < height) visit(tile + width);
    if (y - 1 >= 0) visit(tile - width);
  }

  private hasOwnedNeighbor(tile: number, playerId: number): boolean {
    const width = this.width;
    const height = this.height;
    const x = tile % width;
    const y = (tile - x) / width;
    if (x + 1 < width && this.owner[tile + 1] === playerId) return true;
    if (x - 1 >= 0 && this.owner[tile - 1] === playerId) return true;
    if (y + 1 < height && this.owner[tile + width] === playerId) return true;
    if (y - 1 >= 0 && this.owner[tile - width] === playerId) return true;
    return false;
  }

  private frontierFor(playerId: number): Set<number> {
    let set = this.frontier.get(playerId);
    if (!set) {
      set = new Set<number>();
      this.frontier.set(playerId, set);
    }
    return set;
  }
}

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

export interface WaveScratch {
  readonly stamp: Int32Array;
  readonly queue: Int32Array;
  waveId: number;
}

export function createWaveScratch(tileCount: number): WaveScratch {
  return {
    stamp: new Int32Array(tileCount).fill(-1),
    queue: new Int32Array(tileCount),
    waveId: 0,
  };
}

export interface WaveParams {
  index: TerritoryIndex;
  /** Owned tiles the wave starts from (must belong to the nation). */
  origins: readonly number[];
  /** Troop (or money) budget of the wave. */
  budget: number;
  /** Cost of claiming a tile, given its current owner. */
  costPerTile: (tile: number, tileOwner: number) => number;
  /** Which tiles may be claimed. */
  canClaim: (tile: number, tileOwner: number) => boolean;
  /** Hard cap on claimed tiles. */
  maxTiles: number;
  scratch: WaveScratch;
  /** Terrain layer, used when `landOnly` is enabled. */
  terrain: Uint8Array;
  /** Restrict propagation to land tiles (sea waves are handled separately). */
  landOnly?: boolean;
  /** Optional callback fired for each claimed tile (engine bookkeeping). */
  onClaim?: (tile: number, previousOwner: number) => void;
}

export interface WaveResult {
  claimed: number[];
  spent: number;
  /** True when the wave stopped because the budget ran out. */
  exhausted: boolean;
}

/**
 * Breadth-first territorial wave. Only unclaimed/enemy tiles adjacent to a tile
 * the wave already controls can be taken, which guarantees a contiguous and
 * local expansion (this is the fix for "random" claiming).
 */
export function expandWave(params: WaveParams): WaveResult {
  const { index, origins, scratch, maxTiles } = params;
  const width = index.width;
  const height = index.height;
  const owner = index.owner;
  const terrain = params.terrain;
  const landOnly = params.landOnly !== false;
  const queue = scratch.queue;
  const stamp = scratch.stamp;
  const waveId = ++scratch.waveId;

  let spent = 0;
  let head = 0;
  let tail = 0;
  const claimed: number[] = [];
  let exhausted = false;

  for (const origin of origins) {
    if (stamp[origin] === waveId) continue;
    stamp[origin] = waveId;
    if (tail < queue.length) queue[tail++] = origin;
  }

  while (head < tail) {
    const tile = queue[head++]!;
    const x = tile % width;
    const y = (tile - x) / width;

    for (let direction = 0; direction < 4; direction++) {
      let neighbor: number;
      if (direction === 0) {
        if (x + 1 >= width) continue;
        neighbor = tile + 1;
      } else if (direction === 1) {
        if (x - 1 < 0) continue;
        neighbor = tile - 1;
      } else if (direction === 2) {
        if (y + 1 >= height) continue;
        neighbor = tile + width;
      } else {
        if (y - 1 < 0) continue;
        neighbor = tile - width;
      }
      if (stamp[neighbor] === waveId) continue;
      stamp[neighbor] = waveId;

      if (landOnly && terrain[neighbor] !== LAND) continue;

      const neighborOwner = owner[neighbor]!;
      if (!params.canClaim(neighbor, neighborOwner)) continue;

      const cost = params.costPerTile(neighbor, neighborOwner);
      if (spent + cost > params.budget) {
        exhausted = true;
        break;
      }
      if (claimed.length >= maxTiles) {
        exhausted = true;
        break;
      }
      spent += cost;
      claimed.push(neighbor);
      queue[tail++] = neighbor;
      params.onClaim?.(neighbor, neighborOwner);
      if (tail >= queue.length) {
        // Defensive: cannot happen since every tile is stamped once.
        break;
      }
    }
    if (exhausted) break;
  }

  return { claimed, spent, exhausted };
}

/** Marks a set of tiles as reachable from `origins` without claiming anything. */
export function reachableTiles(
  index: TerritoryIndex,
  origins: readonly number[],
  passes: (tile: number) => boolean,
  scratch: WaveScratch,
): number[] {
  const width = index.width;
  const height = index.height;
  const waveId = ++scratch.waveId;
  const queue = scratch.queue;
  const stamp = scratch.stamp;
  let head = 0;
  let tail = 0;
  const visited: number[] = [];
  for (const origin of origins) {
    if (stamp[origin] === waveId) continue;
    stamp[origin] = waveId;
    queue[tail++] = origin;
  }
  while (head < tail) {
    const tile = queue[head++]!;
    visited.push(tile);
    const x = tile % width;
    const y = (tile - x) / width;
    if (x + 1 < width) {
      const n = tile + 1;
      if (stamp[n] !== waveId && passes(n)) {
        stamp[n] = waveId;
        queue[tail++] = n;
      }
    }
    if (x - 1 >= 0) {
      const n = tile - 1;
      if (stamp[n] !== waveId && passes(n)) {
        stamp[n] = waveId;
        queue[tail++] = n;
      }
    }
    if (y + 1 < height) {
      const n = tile + width;
      if (stamp[n] !== waveId && passes(n)) {
        stamp[n] = waveId;
        queue[tail++] = n;
      }
    }
    if (y - 1 >= 0) {
      const n = tile - width;
      if (stamp[n] !== waveId && passes(n)) {
        stamp[n] = waveId;
        queue[tail++] = n;
      }
    }
  }
  return visited;
}

/**
 * Expanding-ring search used by click-to-attack: finds the owned tile of
 * `playerId` closest to (x, y). Returns -1 when the click is too far.
 */
export function findNearestOwnedTile(
  index: TerritoryIndex,
  terrain: Uint8Array,
  x: number,
  y: number,
  playerId: number,
  maxRadius: number,
): number {
  const width = index.width;
  const height = index.height;
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let radius = 0; radius <= maxRadius; radius++) {
    let best = -1;
    let bestDistance = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      const ty = cy + dy;
      if (ty < 0 || ty >= height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        // Only the ring, the inner disc was already scanned.
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const tx = cx + dx;
        if (tx < 0 || tx >= width) continue;
        const tile = ty * width + tx;
        if (terrain[tile] !== LAND) continue;
        if (index.owner[tile] !== playerId) continue;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = tile;
        }
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

/** Picks `limit` frontier tiles spread over the whole border (deterministic). */
export function spreadFrontierSample(
  frontier: ReadonlySet<number>,
  limit: number,
  offset: number,
): number[] {
  const size = frontier.size;
  if (size === 0 || limit <= 0) return [];
  const tiles = Array.from(frontier);
  // Sort so the sample does not depend on historical insertion order.
  tiles.sort((a, b) => a - b);
  if (size <= limit) return tiles;
  const step = size / limit;
  const result: number[] = [];
  const start = ((offset % size) + size) % size;
  for (let i = 0; i < limit; i++) {
    const position = Math.floor(start + i * step) % size;
    result.push(tiles[position]!);
  }
  return result;
}
