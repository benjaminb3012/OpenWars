/** Naval helpers: water paths, coastal detection, landing geometry. */

import { isWater, LAND } from "../map/grid";

/**
 * True when the straight segment between two tiles only crosses water,
 * endpoints excluded (a boat leaves from a coast and lands on a coast).
 * Uses a dense sampling so a boat can never "teleport" over a continent.
 */
export function waterLineClear(
  terrain: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps <= 1) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(fromX + dx * t);
    const y = Math.round(fromY + dy * t);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (terrain[y * width + x] !== LAND) continue;
    return false;
  }
  return true;
}

export function isCoastalTile(
  terrain: Uint8Array,
  width: number,
  height: number,
  tile: number,
): boolean {
  if (terrain[tile] !== LAND) return false;
  const x = tile % width;
  const y = (tile - x) / width;
  if (x + 1 < width && isWater(terrain[tile + 1]!)) return true;
  if (x - 1 >= 0 && isWater(terrain[tile - 1]!)) return true;
  if (y + 1 < height && isWater(terrain[tile + width]!)) return true;
  if (y - 1 >= 0 && isWater(terrain[tile - width]!)) return true;
  return false;
}

/** First water tile on the segment, used to draw believable boat paths. */
export function firstWaterStep(
  terrain: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(fromX + dx * t);
    const y = Math.round(fromY + dy * t);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    if (isWater(terrain[y * width + x]!)) return { x, y };
  }
  return { x: toX, y: toY };
}
