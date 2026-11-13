import { describe, expect, it } from "vitest";
import { GameImpl } from "../src/game/GameImpl";
import { LAND } from "../src/map/grid";
import { DEFAULT_BALANCE, type BalanceConfig, type GameConfig } from "@openwars/shared";

export const TEST_CONFIG: GameConfig = {
  width: 200,
  height: 140,
  seed: 2024,
  maxPlayers: 4,
  bots: 0,
  tickRate: 10,
  mapStyle: "continents",
};

export function newGame(
  overrides: Partial<GameConfig> = {},
  balance: Partial<BalanceConfig> = {},
): GameImpl {
  return new GameImpl({ ...TEST_CONFIG, ...overrides }, { ...DEFAULT_BALANCE, ...balance });
}

export function addHuman(
  game: GameImpl,
  name: string,
  countryName: string,
  government: "democracy" | "dictatorship" | "monarchy" | "republic" | "communism" | "military" = "democracy",
): number {
  const result = game.addPlayer({
    name,
    countryName,
    flag: "🏳️",
    color: "#3b6bd6",
    government,
    isBot: false,
  });
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

/** Every tile owned by a player must be reachable from their capital. */
export function isTerritoryConnected(game: GameImpl, playerId: number): boolean {
  const width = game.map.width;
  const owner = game.index.owner;
  let start = -1;
  for (let tile = 0; tile < owner.length; tile++) {
    if (owner[tile] === playerId) {
      start = tile;
      break;
    }
  }
  if (start === -1) return true;
  const seen = new Uint8Array(owner.length);
  const stack = [start];
  seen[start] = 1;
  let visited = 0;
  while (stack.length > 0) {
    const tile = stack.pop()!;
    visited++;
    const x = tile % width;
    const y = (tile - x) / width;
    const push = (neighbor: number): void => {
      if (seen[neighbor] || owner[neighbor] !== playerId) return;
      seen[neighbor] = 1;
      stack.push(neighbor);
    };
    if (x + 1 < width) push(tile + 1);
    if (x - 1 >= 0) push(tile - 1);
    if (y >= 0) push(tile + width);
    if (y >= 1) push(tile - width);
  }
  return visited === game.index.count(playerId);
}

export function findFreeLand(game: GameImpl, ownerId = 0): number {
  for (let tile = 0; tile < game.map.terrain.length; tile++) {
    if (game.map.terrain[tile] !== LAND) continue;
    if (game.index.ownerOf(tile) === ownerId) return tile;
  }
  return -1;
}

describe("smoke", () => {
  it("creates a playable game", () => {
    const game = newGame();
    const id = addHuman(game, "Benjamin", "France");
    expect(id).toBe(1);
    expect(game.get(id)!.tiles).toBeGreaterThan(5);
    expect(isTerritoryConnected(game, id)).toBe(true);
  });
});
