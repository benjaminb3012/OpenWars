/** Tile grid helpers. The grid is the single source of truth for territory. */

import { TERRAIN_LAND, TERRAIN_LAKE, TERRAIN_OCEAN } from "@openwars/shared";

export const OCEAN = TERRAIN_OCEAN;
export const LAND = TERRAIN_LAND;
export const LAKE = TERRAIN_LAKE;

export function idxOf(width: number, x: number, y: number): number {
  return y * width + x;
}

export function xOf(width: number, index: number): number {
  return index % width;
}

export function yOf(width: number, index: number): number {
  return (index - (index % width)) / width;
}

export function isWater(terrainValue: number): boolean {
  return terrainValue !== LAND;
}

/** 4-neighbourhood deltas, in a fixed order so every traversal is deterministic. */
export const NEIGHBOR_DX: readonly number[] = [1, -1, 0, 0];
export const NEIGHBOR_DY: readonly number[] = [0, 0, 1, -1];
/** Left-to-right reading order (y then x) for index-stable tie breaking. */
export const NEIGHBOR_DX_YX: readonly number[] = [0, 0, -1, 1];
export const NEIGHBOR_DY_YX: readonly number[] = [-1, 1, 0, 0];

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function neighbors4(
  width: number,
  height: number,
  index: number,
  visit: (neighbor: number) => void,
): void {
  const x = index % width;
  const y = (index - x) / width;
  if (x + 1 < width) visit(index + 1);
  if (x - 1 >= 0) visit(index - 1);
  if (y + 1 < height) visit(index + width);
  if (y - 1 >= 0) visit(index - width);
}

/** Chebyshev distance on the grid. */
export function tileDistance(width: number, a: number, b: number): number {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function squaredTileDistance(width: number, a: number, b: number): number {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
