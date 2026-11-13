/** Strategic strike geometry and interception maths (pure functions). */

export function blastTiles(
  center: number,
  radius: number,
  width: number,
  height: number,
): number[] {
  const cx = center % width;
  const cy = (center - cx) / width;
  const r = Math.max(0, Math.round(radius));
  const tiles: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      if (dx * dx + dy * dy > r * r) continue;
      tiles.push(y * width + x);
    }
  }
  return tiles;
}

/** 1 at the centre, 0 at the edge of the blast. */
export function blastStrength(dx: number, dy: number, radius: number): number {
  if (radius <= 0) return 1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > radius) return 0;
  const t = distance / radius;
  return 1 - t * t;
}

export interface SamCandidate {
  level: number;
  distance: number;
  radius: number;
  ready: boolean;
}

/**
 * Interception probability. Several ready SAM sites combine multiplicatively,
 * so overlapping defences are strong but never reach 100 %.
 */
export function interceptionProbability(
  candidates: readonly SamCandidate[],
  baseInterception: number,
): number {
  let survival = 1;
  for (const candidate of candidates) {
    if (!candidate.ready) continue;
    if (candidate.distance > candidate.radius) continue;
    const falloff = 1 - 0.55 * (candidate.distance / candidate.radius);
    const efficiency = Math.min(1.6, 0.7 + candidate.level * 0.18) * falloff;
    survival *= 1 - Math.min(0.92, baseInterception * efficiency);
  }
  return 1 - survival;
}

/** Deterministic offsets for a MIRV spread. */
export function mirvOffsets(warheads: number): Array<{ dx: number; dy: number }> {
  if (warheads <= 1) return [{ dx: 0, dy: 0 }];
  const offsets: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
  for (let i = 1; i < warheads; i++) {
    const angle = (i / (warheads - 1)) * Math.PI * 2;
    offsets.push({ dx: Math.cos(angle) * 3.2, dy: Math.sin(angle) * 3.2 });
  }
  return offsets;
}
