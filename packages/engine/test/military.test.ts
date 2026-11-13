import { describe, expect, it } from "vitest";
import { addHuman, newGame } from "./helpers";
import { interceptionProbability, blastTiles, blastStrength } from "../src/military/strategic";
import { waterLineClear } from "../src/military/naval";
import { LAND, OCEAN } from "../src/map/grid";

describe("strategic weapons", () => {
  it("requires a missile silo and money", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const capital = game.get(id)!.capital;
    const x = capital % game.map.width;
    const y = Math.floor(capital / game.map.width);
    const noSilo = game.tryLaunchMissile(id, "missile", x, y);
    expect(noSilo.ok).toBe(false);
    expect(noSilo.error).toContain("lance-missiles");
  });

  it("flies, impacts and leaves scorch marks", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 40000;
    const capital = player.capital;
    const width = game.map.width;
    expect(game.tryBuild(id, "missile_silo", capital % width, Math.floor(capital / width)).ok).toBe(true);
    const launch = game.tryLaunchMissile(id, "missile", capital % width, Math.floor(capital / width));
    expect(launch.ok).toBe(true);
    expect(game.getMissiles().length).toBeGreaterThan(0);
    // Cooldown is enforced.
    const again = game.tryLaunchMissile(id, "missile", capital % width, Math.floor(capital / width));
    expect(again.ok).toBe(false);

    for (let tick = 0; tick < 60; tick++) game.advance();
    expect(game.getMissiles().length).toBe(0);
    const intercepted = game
      .getEvents()
      .recent(40)
      .some((event) => event.message.includes("intercepté"));
    const scorched = game.snapshot().scorch.length > 0;
    expect(intercepted || scorched).toBe(true);
  });

  it("combines overlapping SAM sites", () => {
    const single = interceptionProbability(
      [{ level: 1, distance: 1, radius: 8, ready: true }],
      0.5,
    );
    const triple = interceptionProbability(
      [
        { level: 1, distance: 1, radius: 8, ready: true },
        { level: 2, distance: 2, radius: 8, ready: true },
        { level: 3, distance: 3, radius: 9, ready: true },
      ],
      0.5,
    );
    expect(triple).toBeGreaterThan(single);
    expect(triple).toBeLessThan(1);
    const notReady = interceptionProbability(
      [{ level: 3, distance: 1, radius: 8, ready: false }],
      0.9,
    );
    expect(notReady).toBe(0);
  });

  it("computes blast falloff", () => {
    const tiles = blastTiles(500, 3, 40, 40);
    expect(tiles.length).toBeGreaterThan(20);
    expect(blastStrength(0, 0, 5)).toBe(1);
    expect(blastStrength(5, 0, 5)).toBe(0);
    expect(blastStrength(2.5, 0, 5)).toBeLessThan(1);
  });
});

describe("naval", () => {
  it("requires a port to launch a landing", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const capital = game.get(id)!.capital;
    const result = game.trySendBoat(
      id,
      capital % game.map.width,
      Math.floor(capital / game.map.width),
      100,
      "transport",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("port");
  });

  it("detects blocked sea routes", () => {
    const width = 20;
    const height = 3;
    const terrain = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        terrain[y * width + x] = y === 1 ? LAND : OCEAN;
      }
    }
    // Same row crossing land -> blocked.
    expect(waterLineClear(terrain, width, height, 0, 0, 19, 0)).toBe(true);
    expect(waterLineClear(terrain, width, height, 0, 1, 19, 1)).toBe(false);
    expect(waterLineClear(terrain, width, height, 0, 0, 19, 2)).toBe(false);
  });
});
