import { describe, expect, it } from "vitest";
import { addHuman, isTerritoryConnected, newGame } from "./helpers";
import { LAND } from "../src/map/grid";

describe("territorial propagation", () => {
  it("only claims tiles adjacent to controlled territory", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    const tilesBefore = game.index.count(id);
    expect(tilesBefore).toBeGreaterThan(0);

    for (let tick = 0; tick < 120; tick++) game.advance();

    const width = game.map.width;
    const owner = game.index.owner;
    // Every owned tile must touch another owned tile (except a single-tile nation).
    let isolated = 0;
    for (let tile = 0; tile < owner.length; tile++) {
      if (owner[tile] !== id) continue;
      const x = tile % width;
      const y = (tile - x) / width;
      let neighbours = 0;
      if (x + 1 < width && owner[tile + 1] === id) neighbours++;
      if (x - 1 >= 0 && owner[tile - 1] === id) neighbours++;
      if (y + 1 < game.map.height && owner[tile + width] === id) neighbours++;
      if (y - 1 >= 0 && owner[tile - width] === id) neighbours++;
      if (neighbours === 0) isolated++;
    }
    expect(isolated).toBe(0);
    expect(isTerritoryConnected(game, id)).toBe(true);
    expect(game.index.count(id)).toBeGreaterThan(tilesBefore);
  });

  it("never grows across water", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    for (let tick = 0; tick < 200; tick++) game.advance();
    const owner = game.index.owner;
    for (let tile = 0; tile < owner.length; tile++) {
      if (owner[tile] !== id) continue;
      expect(game.map.terrain[tile]).toBe(LAND);
    }
    expect(isTerritoryConnected(game, id)).toBe(true);
  });

  it("is deterministic: identical games produce identical territories", () => {
    const run = (): number[] => {
      const game = newGame({ seed: 777 });
      addHuman(game, "A", "Alpha");
      addHuman(game, "B", "Beta");
      for (let tick = 0; tick < 150; tick++) game.advance();
      return Array.from(game.index.owner);
    };
    expect(run()).toEqual(run());
  });

  it("rejects attacks that are not on a border", () => {
    const game = newGame();
    const a = addHuman(game, "A", "Alpha");
    const b = addHuman(game, "B", "Beta");
    // Find a tile of B that is far from A: the attack must be refused.
    const capitalB = game.get(b)!.capital;
    const bx = capitalB % game.map.width;
    const by = Math.floor(capitalB / game.map.width);
    const before = game.index.count(b);
    const result = game.tryAttack(a, bx, by);
    expect(result.ok).toBe(false);
    expect(game.index.count(b)).toBe(before);
  });

  it("conquers contiguous enemy tiles from a border", () => {
    const game = newGame({}, { spawnProtectionTicks: 0 });
    const a = addHuman(game, "A", "Alpha");
    const b = addHuman(game, "B", "Beta");
    const width = game.map.width;
    const height = game.map.height;
    const owner = game.index.owner;

    // Find a 22x18 patch of free land and paint two neighbouring nations.
    let origin = -1;
    for (let y = 2; y < height - 20 && origin === -1; y++) {
      for (let x = 2; x < width - 24; x++) {
        let clear = true;
        for (let dy = 0; dy < 18 && clear; dy++) {
          for (let dx = 0; dx < 22; dx++) {
            const tile = (y + dy) * width + (x + dx);
            if (game.map.terrain[tile] !== LAND || owner[tile] !== 0) {
              clear = false;
              break;
            }
          }
        }
        if (clear) {
          origin = y * width + x;
          break;
        }
      }
    }
    expect(origin).toBeGreaterThan(0);
    const ox = origin % width;
    const oy = Math.floor(origin / width);
    for (let dy = 0; dy < 18; dy++) {
      for (let dx = 0; dx < 11; dx++) {
        game.setTileOwner((oy + dy) * width + (ox + dx), a);
      }
      for (let dx = 11; dx < 22; dx++) {
        game.setTileOwner((oy + dy) * width + (ox + dx), b);
      }
    }

    const beforeB = game.index.count(b);
    const beforeA = game.index.count(a);
    const defender = game.get(b)!;
    defender.troops = 400;
    const player = game.get(a)!;
    player.troops = 4000;
    const targetTile = (oy + 9) * width + (ox + 11);
    const result = game.tryAttack(a, targetTile % width, Math.floor(targetTile / width), 2000);
    expect(result.ok).toBe(true);
    expect(game.index.count(b)).toBeLessThan(beforeB);
    expect(game.index.count(a)).toBeGreaterThan(beforeA);
    expect(defender.troops).toBeLessThan(400);
    // The conquered tiles are adjacent to the attacker's block: no enclave.
    expect(game.ownerAt(ox + 11, oy + 9)).toBe(a);
  });

  it("refuses to attack an ally", () => {
    const game = newGame({}, { spawnProtectionTicks: 0 });
    const a = addHuman(game, "A", "Alpha");
    const b = addHuman(game, "B", "Beta");
    game.tryRequestAlliance(a, b);
    const response = game.tryRespondAlliance(b, a, true);
    expect(response.ok).toBe(true);
    const capital = game.get(b)!.capital;
    const result = game.tryAttack(
      a,
      capital % game.map.width,
      Math.floor(capital / game.map.width),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("allié");
  });

  it("colonisation spreads around the whole border instead of one corner", () => {
    const game = newGame();
    const id = addHuman(game, "A", "Alpha");
    for (let tick = 0; tick < 400; tick++) game.advance();
    const width = game.map.width;
    const capital = game.get(id)!.capital;
    const cx = capital % width;
    const cy = Math.floor(capital / width);
    // Count owned tiles in each quadrant: growth must not be one-sided.
    const quadrants = [0, 0, 0, 0];
    const owner = game.index.owner;
    for (let tile = 0; tile < owner.length; tile++) {
      if (owner[tile] !== id) continue;
      const x = tile % width;
      const y = Math.floor(tile / width);
      const index = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
      quadrants[index]! += 1;
    }
    const nonEmpty = quadrants.filter((value) => value > 2).length;
    expect(nonEmpty).toBeGreaterThanOrEqual(3);
  });
});
