/**
 * Deterministic map generation.
 *
 * Goals (see docs/TERRITORY.md):
 *  - coherent landmasses with natural coastlines, no salt-and-pepper islands;
 *  - oceans, seas and lakes clearly separated;
 *  - provinces (regions) that follow geography, used for spawns and secession;
 *  - fair, well separated spawns.
 *
 * The very same function runs on the server and in the browser, so the client
 * can rebuild the terrain from `{seed, width, height, style}` without shipping
 * a single byte of map data.
 */

import type { GameConfig } from "@openwars/shared";
import { createRng } from "../rng";
import { fbm, ridged } from "./noise";
import { idxOf, LAND, LAKE, OCEAN } from "./grid";

export type MapStyle = GameConfig["mapStyle"];

export interface MapGenerationOptions {
  width: number;
  height: number;
  seed: number;
  style: MapStyle;
  /** How many nations must be able to spawn. */
  playerCount: number;
}

export interface GameMapData {
  width: number;
  height: number;
  seed: number;
  style: MapStyle;
  /** 0 = ocean, 1 = land, 2 = lake. */
  terrain: Uint8Array;
  /** 0..255 shading value, purely cosmetic. */
  elevation: Uint8Array;
  /** Province id, 0 for water. */
  region: Uint16Array;
  /** Spawn tile per player slot. */
  spawns: number[];
  landTiles: number;
}

interface LandFractionByStyle {
  continents: number;
  archipelago: number;
  pangaea: number;
}

const LAND_FRACTION: LandFractionByStyle = {
  continents: 0.34,
  archipelago: 0.24,
  pangaea: 0.42,
};

function targetLandFraction(style: MapStyle, rng: () => number): number {
  const base = LAND_FRACTION[style];
  return base + (rng() - 0.5) * 0.04;
}

/** Picks `count` points spread as far apart as possible (farthest point sampling). */
function farthestPoints(
  count: number,
  candidates: Array<{ x: number; y: number }>,
  rng: { int(maxExclusive: number): number },
): Array<{ x: number; y: number }> {
  const chosen: Array<{ x: number; y: number }> = [];
  if (candidates.length === 0) return chosen;
  chosen.push(candidates[rng.int(candidates.length)]!);
  while (chosen.length < count) {
    let best: { x: number; y: number } | null = null;
    let bestDistance = -1;
    for (let i = 0; i < 64; i++) {
      const candidate = candidates[rng.int(candidates.length)]!;
      let nearest = Infinity;
      for (const point of chosen) {
        const dx = point.x - candidate.x;
        const dy = point.y - candidate.y;
        const d = dx * dx + dy * dy;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

/** Majority filter: removes single-tile noise and uninteresting specks. */
function smoothMask(mask: Uint8Array, width: number, height: number, passes: number): void {
  const scratch = new Uint8Array(mask.length);
  for (let pass = 0; pass < passes; pass++) {
    scratch.set(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        let land = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = i + dy * width;
          land += scratch[row - 1]! + scratch[row]! + scratch[row + 1]!;
        }
        // 9 cells: land if at least 5 of 9 are land, keeps the original bias.
        mask[i] = land >= 5 ? 1 : 0;
      }
    }
  }
}

interface ComponentStats {
  /** Component id per tile, -1 for tiles that are not part of the mask. */
  component: Int32Array;
  sizes: number[];
}

function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  match: (value: number) => boolean,
): ComponentStats {
  const component = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (component[start] !== -1) continue;
    if (!match(mask[start]!)) continue;
    const id = sizes.length;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    component[start] = id;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size++;
      const x = index % width;
      const y = (index - x) / width;
      if (x + 1 < width) {
        const n = index + 1;
        if (component[n] === -1 && match(mask[n]!)) {
          component[n] = id;
          stack.push(n);
        }
      }
      if (x - 1 >= 0) {
        const n = index - 1;
        if (component[n] === -1 && match(mask[n]!)) {
          component[n] = id;
          stack.push(n);
        }
      }
      if (y + 1 < height) {
        const n = index + width;
        if (component[n] === -1 && match(mask[n]!)) {
          component[n] = id;
          stack.push(n);
        }
      }
      if (y - 1 >= 0) {
        const n = index - width;
        if (component[n] === -1 && match(mask[n]!)) {
          component[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return { component, sizes };
}

export function generateMap(options: MapGenerationOptions): GameMapData {
  const width = Math.max(64, Math.round(options.width));
  const height = Math.max(48, Math.round(options.height));
  const count = width * height;
  const rng = createRng(options.seed ^ 0x5f3759df);
  const random = () => rng.next();

  // --- Continental field ---------------------------------------------------
  const continentCount =
    options.style === "pangaea" ? 2 : options.style === "archipelago" ? 9 : 5;
  const margin = Math.min(width, height) * 0.12;
  const candidates: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 160; i++) {
    candidates.push({
      x: margin + random() * (width - margin * 2),
      y: margin + random() * (height - margin * 2),
    });
  }
  const continentSeeds = farthestPoints(continentCount, candidates, rng);
  const sigma =
    Math.min(width, height) * (options.style === "archipelago" ? 0.15 : 0.3) *
    (0.85 + random() * 0.3);

  const landFraction = targetLandFraction(options.style, random);
  const heightScale = 0.055;
  const warpScale = 0.02;
  const scores = new Float32Array(count);
  const noiseSeed = options.seed ^ 0x1b873593;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Domain warp keeps coastlines irregular instead of "blobby".
      const wx = fbm(x * warpScale, y * warpScale, noiseSeed + 17, 3);
      const wy = fbm(x * warpScale + 5.2, y * warpScale + 1.3, noiseSeed + 29, 3);
      const px = x + (wx - 0.5) * 26;
      const py = y + (wy - 0.5) * 26;

      let continent = 0;
      for (const seed of continentSeeds) {
        const dx = px - seed.x;
        const dy = py - seed.y;
        const influence = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        if (influence > continent) continent = influence;
      }

      const detail = fbm(px * heightScale, py * heightScale, noiseSeed, 5);
      const ridge = ridged(px * 0.035, py * 0.035, noiseSeed + 271, 3);
      // Small scale erosion: makes coastlines fjord-like rather than smooth.
      const erosion = fbm(px * 0.12, py * 0.12, noiseSeed + 911, 2);
      scores[y * width + x] =
        continent * 0.72 + detail * 0.42 + ridge * 0.1 - erosion * 0.06;
    }
  }

  // Threshold chosen by quantile so the land share is exactly what we asked for.
  const sorted = Float32Array.from(scores).sort();
  const thresholdIndex = Math.min(
    count - 1,
    Math.max(0, Math.floor(sorted.length * (1 - landFraction))),
  );
  const threshold = sorted[thresholdIndex]!;

  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) mask[i] = scores[i]! >= threshold ? 1 : 0;

  // A map that is half noise looks bad: smooth twice, then clean components.
  smoothMask(mask, width, height, 2);

  const landComponents = labelComponents(mask, width, height, (v) => v === 1);
  const minLandSize = Math.max(28, Math.round(count * 0.0011));
  for (let i = 0; i < count; i++) {
    const id = landComponents.component[i]!;
    if (id >= 0 && landComponents.sizes[id]! < minLandSize) mask[i] = 0;
  }

  // Re-label water: what is reachable from the border is ocean, the rest lakes.
  const waterComponents = labelComponents(mask, width, height, (v) => v === 0);
  const oceanComponents = new Set<number>();
  for (let x = 0; x < width; x++) {
    const top = waterComponents.component[x]!;
    const bottom = waterComponents.component[(height - 1) * width + x]!;
    if (top >= 0) oceanComponents.add(top);
    if (bottom >= 0) oceanComponents.add(bottom);
  }
  for (let y = 0; y < height; y++) {
    const left = waterComponents.component[y * width]!;
    const right = waterComponents.component[y * width + width - 1]!;
    if (left >= 0) oceanComponents.add(left);
    if (right >= 0) oceanComponents.add(right);
  }

  const minLakeSize = Math.max(12, Math.round(count * 0.0004));
  const terrain = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (mask[i] === 1) {
      terrain[i] = LAND;
      continue;
    }
    const componentId = waterComponents.component[i]!;
    const isOcean = componentId >= 0 && oceanComponents.has(componentId);
    if (!isOcean && waterComponents.sizes[componentId]! < minLakeSize) {
      // Fill tiny inland ponds so the map reads cleanly.
      terrain[i] = LAND;
      mask[i] = 1;
    } else {
      terrain[i] = isOcean ? OCEAN : LAKE;
    }
  }

  // Remove land specks created by the lake filling step.
  const finalLandComponents = labelComponents(mask, width, height, (v) => v === 1);
  for (let i = 0; i < count; i++) {
    const id = finalLandComponents.component[i]!;
    if (id >= 0 && finalLandComponents.sizes[id]! < Math.max(16, minLandSize / 2)) {
      terrain[i] = OCEAN;
      mask[i] = 0;
    }
  }

  let landTiles = 0;
  for (let i = 0; i < count; i++) if (terrain[i] === LAND) landTiles++;

  // --- Provinces -----------------------------------------------------------
  const regionCount = Math.max(10, Math.round(landTiles / 190));
  const landCandidates: Array<{ x: number; y: number }> = [];
  const landIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (terrain[i] === LAND) {
      landIndices.push(i);
      landCandidates.push({ x: i % width, y: (i - (i % width)) / width });
    }
  }
  const regionSeeds = farthestPoints(regionCount, landCandidates, rng);
  const region = new Uint16Array(count);
  const queue: number[] = [];
  regionSeeds.forEach((point, index) => {
    const tile = idxOf(width, Math.round(point.x), Math.round(point.y));
    if (terrain[tile] === LAND && region[tile] === 0) {
      region[tile] = index + 1;
      queue.push(tile);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    const regionId = region[index]!;
    const x = index % width;
    const y = (index - x) / width;
    if (x + 1 < width) {
      const n = index + 1;
      if (terrain[n] === LAND && region[n] === 0) {
        region[n] = regionId;
        queue.push(n);
      }
    }
    if (x - 1 >= 0) {
      const n = index - 1;
      if (terrain[n] === LAND && region[n] === 0) {
        region[n] = regionId;
        queue.push(n);
      }
    }
    if (y + 1 < height) {
      const n = index + width;
      if (terrain[n] === LAND && region[n] === 0) {
        region[n] = regionId;
        queue.push(n);
      }
    }
    if (y - 1 >= 0) {
      const n = index - width;
      if (terrain[n] === LAND && region[n] === 0) {
        region[n] = regionId;
        queue.push(n);
      }
    }
  }

  // --- Spawns --------------------------------------------------------------
  const spawns = pickSpawns(terrain, width, height, options.playerCount, random);

  // --- Cosmetic elevation --------------------------------------------------
  const elevation = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (terrain[i] !== LAND) {
      elevation[i] = 0;
      continue;
    }
    const value = Math.min(1, Math.max(0, (scores[i]! - threshold) * 3.4 + 0.15));
    elevation[i] = Math.round(value * 255);
  }

  return {
    width,
    height,
    seed: options.seed,
    style: options.style,
    terrain,
    elevation,
    region,
    spawns,
    landTiles,
  };
}

/**
 * Spawns are placed on distinct provinces, as far apart as possible, and only
 * on tiles that have enough room to grow (no one-tile islands).
 */
function pickSpawns(
  terrain: Uint8Array,
  width: number,
  height: number,
  playerCount: number,
  random: () => number,
): number[] {
  const candidates: number[] = [];
  const count = terrain.length;
  for (let i = 0; i < count; i++) {
    if (terrain[i] !== LAND) continue;
    // Cheap room check: count land in a radius of 6 (13x13 box).
    const x = i % width;
    const y = (i - x) / width;
    if (x < 7 || y < 7 || x >= width - 7 || y >= height - 7) continue;
    let land = 0;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (dx * dx + dy * dy > 36) continue;
        if (terrain[i + dy * width + dx] === LAND) land++;
      }
    }
    if (land >= 70) candidates.push(i);
  }
  if (candidates.length === 0) {
    for (let i = 0; i < count; i++) if (terrain[i] === LAND) candidates.push(i);
  }

  const chosen: number[] = [];
  if (candidates.length === 0) return chosen;
  const minDistance = Math.min(width, height) * 0.22;
  let attempts = 0;
  while (chosen.length < playerCount && attempts < 4000) {
    const candidate = candidates[Math.floor(random() * candidates.length)]!;
    attempts++;
    const cx = candidate % width;
    const cy = (candidate - cx) / width;
    let ok = true;
    for (const existing of chosen) {
      const ex = existing % width;
      const ey = (existing - ex) / width;
      const dx = cx - ex;
      const dy = cy - ey;
      if (dx * dx + dy * dy < minDistance * minDistance) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(candidate);
  }
  // Relax the constraint if the map could not host everyone.
  attempts = 0;
  while (chosen.length < playerCount && attempts < 2000) {
    const candidate = candidates[Math.floor(random() * candidates.length)]!;
    attempts++;
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }
  return chosen;
}
