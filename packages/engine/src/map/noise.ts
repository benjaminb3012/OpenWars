/** Value noise + fractal brownian motion, seeded and fully deterministic. */

import { hashUnit } from "../rng";

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise in [0,1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = hashUnit(x0, y0, seed);
  const v10 = hashUnit(x0 + 1, y0, seed);
  const v01 = hashUnit(x0, y0 + 1, seed);
  const v11 = hashUnit(x0 + 1, y0 + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal brownian motion, result in [0,1). */
export function fbm(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + i * 1013);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise, useful for mountain chains and inland seas. */
export function ridged(x: number, y: number, seed: number, octaves = 3): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency, seed + i * 7919) * 2 - 1);
    sum += amplitude * n * n;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum / norm;
}
