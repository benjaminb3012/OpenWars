import { describe, expect, it } from "vitest";
import { addHuman, newGame } from "./helpers";
import { BUILDINGS } from "@openwars/shared";
import { LAND } from "../src/map/grid";
import { computeTransportNetworks } from "../src/economy/transport";
import { cityProductionBonus, incomeBreakdown, maxPopulationOf } from "../src/economy/production";
import { modifiersOf } from "../src/politics/governments";
import { DEFAULT_BALANCE } from "@openwars/shared";

describe("building placement", () => {
  it("builds on owned land only", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 5000;
    const capital = player.capital;
    const cx = capital % game.map.width;
    const cy = Math.floor(capital / game.map.width);

    expect(game.tryBuild(id, "city", cx, cy).ok).toBe(true);
    // Same tile twice is refused.
    expect(game.tryBuild(id, "city", cx, cy).ok).toBe(false);
    // A tile that is not owned is refused.
    const foreign = game.tryBuild(id, "city", cx + 400, cy + 400);
    expect(foreign.ok).toBe(false);
  });

  it("requires a coast for ports", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 5000;
    const width = game.map.width;
    // Give the player a coastal tile.
    let coastal = -1;
    for (let tile = 0; tile < game.map.terrain.length; tile++) {
      if (game.map.terrain[tile] !== LAND) continue;
      if (!game.buildings.isCoastal(tile)) continue;
      coastal = tile;
      break;
    }
    expect(coastal).toBeGreaterThan(0);
    game.setTileOwner(coastal, id);

    expect(game.buildings.canPlace(id, "port", coastal).ok).toBe(true);
    const inland = player.capital;
    const inlandCheck = game.buildings.canPlace(id, "port", inland);
    expect(inlandCheck.ok).toBe(false);
    void width;
  });

  it("refuses buildings when the player cannot pay", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 10;
    const capital = player.capital;
    const result = game.tryBuild(
      id,
      "missile_silo",
      capital % game.map.width,
      Math.floor(capital / game.map.width),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("manque");
  });

  it("upgrades cost money and increase the level", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 8000;
    const capital = player.capital;
    const built = game.tryBuild(
      id,
      "city",
      capital % game.map.width,
      Math.floor(capital / game.map.width),
    );
    expect(built.ok).toBe(true);
    const city = game.buildings.listOf(id).find((building) => building.type === "city")!;
    expect(city.level).toBe(1);
    const upgrade = game.tryUpgrade(id, city.id);
    expect(upgrade.ok).toBe(true);
    expect(city.level).toBe(2);
  });
});

describe("transport network", () => {
  it("connects a factory to a city through roads", () => {
    const game = newGame({}, { networkRecomputeTicks: 1 });
    const id = addHuman(game, "A", "Alpha");
    const player = game.get(id)!;
    player.money = 20000;
    const width = game.map.width;
    const capital = player.capital;
    const cx = capital % width;
    const cy = Math.floor(capital / width);
    expect(game.tryBuild(id, "city", cx, cy).ok).toBe(true);

    // Use the owned tile farthest from the capital so the road is meaningful.
    let factoryTile = -1;
    let bestDistance = 0;
    for (let tile = 0; tile < game.index.owner.length; tile++) {
      if (game.index.ownerOf(tile) !== id) continue;
      if (!game.buildings.canPlace(id, "factory", tile).ok) continue;
      const distance = Math.abs((tile % width) - cx) + Math.abs(Math.floor(tile / width) - cy);
      if (distance > bestDistance) {
        bestDistance = distance;
        factoryTile = tile;
      }
    }
    expect(factoryTile).toBeGreaterThan(0);
    expect(game.tryBuild(id, "factory", factoryTile % width, Math.floor(factoryTile / width)).ok).toBe(true);
    const factory = game.buildings.listOf(id).find((building) => building.type === "factory")!;

    for (let tick = 0; tick < 40; tick++) game.advance();
    expect(factory.connected).toBe(false);

    const roads = game.tryBuildRoadPath(id, factoryTile, capital);
    expect(roads.ok).toBe(true);
    for (let tick = 0; tick < 10; tick++) game.advance();
    expect(factory.connected).toBe(true);
  });

  it("computes connectivity deterministically on a synthetic layout", () => {
    const width = 12;
    const height = 6;
    const road = new Uint16Array(width * height);
    // Horizontal road on row 2 from x=1 to x=6 owned by player 1.
    for (let x = 1; x <= 6; x++) road[2 * width + x] = 1;
    const buildings = [
      { id: 1, type: "city" as const, tile: 2 * width + 1, ownerId: 1 },
      { id: 2, type: "factory" as const, tile: 2 * width + 6, ownerId: 1 },
      { id: 3, type: "factory" as const, tile: 5 * width + 10, ownerId: 1 },
    ];
    const result = computeTransportNetworks({ width, height, road, buildings });
    expect(result.connected.has(1)).toBe(true);
    expect(result.connected.has(2)).toBe(true);
    // The second factory has no road at all.
    expect(result.connected.has(3)).toBe(false);
  });

  it("gives cities a cumulative production bonus", () => {
    const modifiers = modifiersOf("republic");
    expect(cityProductionBonus(1, DEFAULT_BALANCE.cityProductionBonus)).toBeCloseTo(1.02);
    expect(cityProductionBonus(10, DEFAULT_BALANCE.cityProductionBonus)).toBeCloseTo(1.2);

    const base = {
      tiles: 200,
      population: 2000,
      cities: 0,
      factoryLevels: 4,
      ports: 0,
      airports: 0,
      upkeep: 1,
      taxRate: 30,
      happiness: 70,
      modifiers,
      balance: DEFAULT_BALANCE,
    };
    const withoutCities = incomeBreakdown(base);
    const withCities = incomeBreakdown({ ...base, cities: 5 });
    expect(withCities.industrial).toBeGreaterThan(withoutCities.industrial);
    expect(withCities.net).toBeGreaterThan(withoutCities.net);

    const popWithout = maxPopulationOf(100, 0, modifiers, DEFAULT_BALANCE);
    const popWith = maxPopulationOf(100, 5, modifiers, DEFAULT_BALANCE);
    expect(popWith).toBeGreaterThan(popWithout);
  });

  it("keeps city bonuses finite for very large empires", () => {
    const bonus = cityProductionBonus(500, DEFAULT_BALANCE.cityProductionBonus);
    expect(Number.isFinite(bonus)).toBe(true);
    expect(bonus).toBeCloseTo(11);
  });
});
