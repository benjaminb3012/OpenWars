import { describe, expect, it } from "vitest";
import { addHuman, newGame } from "./helpers";
import { GameImpl } from "../src/game/GameImpl";
import type { GameConfig } from "@openwars/shared";

const CONFIG: GameConfig = {
  width: 160,
  height: 120,
  seed: 31337,
  maxPlayers: 3,
  bots: 2,
  tickRate: 10,
  mapStyle: "continents",
};

function scriptedGame(): GameImpl {
  const game = new GameImpl(CONFIG);
  const a = addHuman(game, "A", "Alpha", "republic");
  const b = addHuman(game, "B", "Beta", "military");
  const capitalA = game.get(a)!.capital;
  const width = game.map.width;
  game.tryBuild(a, "city", capitalA % width, Math.floor(capitalA / width));
  game.tryRequestAlliance(a, b);
  game.tryRespondAlliance(b, a, true);
  game.tryBuildRoadPath(a, capitalA, capitalA + 4);
  game.trySetTax(a, 45);
  game.trySetGovernment(b, "democracy");
  for (let tick = 0; tick < 320; tick++) {
    if (tick === 120) {
      const capital = game.get(a)!.capital;
      game.tryAttack(a, capital % width + 2, Math.floor(capital / width));
    }
    game.advance();
  }
  return game;
}

describe("determinism", () => {
  it("two identical runs produce identical state", () => {
    const first = scriptedGame();
    const second = scriptedGame();

    expect(Array.from(first.index.owner)).toEqual(Array.from(second.index.owner));
    expect(first.tick).toBe(second.tick);
    const firstPlayers = first.allPlayers().map((player) => ({
      id: player.id,
      money: Math.round(player.money),
      troops: Math.round(player.troops),
      population: Math.round(player.population),
      tiles: player.tiles,
      happiness: Math.round(player.country.happiness * 100),
      discontent: Math.round(player.country.discontent * 100),
    }));
    const secondPlayers = second.allPlayers().map((player) => ({
      id: player.id,
      money: Math.round(player.money),
      troops: Math.round(player.troops),
      population: Math.round(player.population),
      tiles: player.tiles,
      happiness: Math.round(player.country.happiness * 100),
      discontent: Math.round(player.country.discontent * 100),
    }));
    expect(firstPlayers).toEqual(secondPlayers);

    const firstBuildings = Array.from(first.buildings.buildings.values()).map((building) => ({
      id: building.id,
      type: building.type,
      tile: building.tile,
      level: building.level,
    }));
    const secondBuildings = Array.from(second.buildings.buildings.values()).map((building) => ({
      id: building.id,
      type: building.type,
      tile: building.tile,
      level: building.level,
    }));
    expect(firstBuildings).toEqual(secondBuildings);
  });

  it("keeps numbers finite over a long run", () => {
    const game = newGame({ bots: 2 });
    addHuman(game, "A", "Alpha");
    for (let tick = 0; tick < 500; tick++) game.advance();
    for (const player of game.allPlayers()) {
      expect(Number.isFinite(player.money)).toBe(true);
      expect(Number.isFinite(player.troops)).toBe(true);
      expect(Number.isFinite(player.population)).toBe(true);
      expect(player.money).toBeGreaterThanOrEqual(0);
      expect(player.troops).toBeGreaterThanOrEqual(0);
      expect(player.population).toBeGreaterThanOrEqual(0);
      expect(player.country.happiness).toBeGreaterThanOrEqual(0);
      expect(player.country.happiness).toBeLessThanOrEqual(100);
    }
  });

  it("produces a serialisable snapshot and update", () => {
    const game = newGame();
    addHuman(game, "A", "Alpha");
    for (let tick = 0; tick < 30; tick++) game.advance();
    const snapshot = game.snapshot();
    const json = JSON.stringify(snapshot);
    expect(json.length).toBeGreaterThan(100);
    const decoded = JSON.parse(json) as typeof snapshot;
    expect(decoded.players.length).toBe(1);
    expect(decoded.map.width).toBe(game.map.width);
    // Owner layer is base64 and decodes to the tile count.
    const bytes = Buffer.from(decoded.owner, "base64");
    expect(bytes.length).toBeGreaterThanOrEqual(game.map.width * game.map.height);
  });
});
