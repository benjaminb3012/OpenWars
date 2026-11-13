import { describe, expect, it } from "vitest";
import { generateMap } from "../src/map/generate";
import { LAND, OCEAN, LAKE } from "../src/map/grid";

const OPTIONS = {
  width: 240,
  height: 160,
  seed: 4242,
  style: "continents" as const,
  playerCount: 6,
};

describe("map generation", () => {
  it("is deterministic for a given seed", () => {
    const a = generateMap(OPTIONS);
    const b = generateMap(OPTIONS);
    expect(a.landTiles).toBe(b.landTiles);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(Array.from(a.region)).toEqual(Array.from(b.region));
    expect(a.spawns).toEqual(b.spawns);
  });

  it("produces a coherent land share with oceans and lakes", () => {
    const map = generateMap(OPTIONS);
    const fraction = map.landTiles / (map.width * map.height);
    expect(fraction).toBeGreaterThan(0.2);
    expect(fraction).toBeLessThan(0.5);
    let ocean = 0;
    let lake = 0;
    for (const tile of map.terrain) {
      if (tile === OCEAN) ocean++;
      if (tile === LAKE) lake++;
    }
    expect(ocean).toBeGreaterThan(map.landTiles * 0.5);
    // Every map has at least one ocean and the water is split in coherent bodies.
    expect(ocean).toBeGreaterThan(0);
    expect(lake).toBeLessThan(ocean);
  });

  it("has no tiny isolated land specks", () => {
    const map = generateMap(OPTIONS);
    const seen = new Uint8Array(map.terrain.length);
    const sizes: number[] = [];
    for (let start = 0; start < map.terrain.length; start++) {
      if (seen[start] || map.terrain[start] !== LAND) continue;
      let size = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const tile = stack.pop()!;
        size++;
        const x = tile % map.width;
        const y = (tile - x) / map.width;
        const push = (neighbor: number): void => {
          if (seen[neighbor] || map.terrain[neighbor] !== LAND) return;
          seen[neighbor] = 1;
          stack.push(neighbor);
        };
        if (x + 1 < map.width) push(tile + 1);
        if (x - 1 >= 0) push(tile - 1);
        if (y + 1 < map.height) push(tile + map.width);
        if (y - 1 >= 0) push(tile - map.width);
      }
      sizes.push(size);
    }
    expect(sizes.length).toBeGreaterThan(0);
    // The generator removes components smaller than ~0.1 % of the map.
    expect(Math.min(...sizes)).toBeGreaterThan(10);
  });

  it("places spawns on land, far apart", () => {
    const map = generateMap({ ...OPTIONS, playerCount: 8 });
    expect(map.spawns.length).toBeGreaterThanOrEqual(6);
    for (const spawn of map.spawns) {
      expect(map.terrain[spawn]).toBe(LAND);
    }
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const a = map.spawns[i]!;
        const b = map.spawns[j]!;
        const ax = a % map.width;
        const ay = (a - ax) / map.width;
        const bx = b % map.width;
        const by = (b - bx) / map.width;
        const distance = Math.hypot(ax - bx, ay - by);
        expect(distance).toBeGreaterThan(20);
      }
    }
  });

  it("generates every style", () => {
    for (const style of ["continents", "archipelago", "pangaea"] as const) {
      const map = generateMap({ ...OPTIONS, style, seed: 99 });
      expect(map.landTiles).toBeGreaterThan(1000);
      expect(map.spawns.length).toBeGreaterThan(0);
    }
  });
});
