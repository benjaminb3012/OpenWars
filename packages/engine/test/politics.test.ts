import { describe, expect, it } from "vitest";
import { addHuman, isTerritoryConnected, newGame } from "./helpers";
import { civilWarPossible, computeHappiness } from "../src/politics/happiness";
import { modifiersOf, taxFactor } from "../src/politics/governments";
import { DEFAULT_BALANCE, GOVERNMENTS } from "@openwars/shared";

const BASE_INPUT = {
  taxRate: 30,
  wars: 0,
  recentLosses: 0,
  tiles: 100,
  fortCoverage: 0,
  incomePerTick: 5,
  atCivilWarRisk: false,
};

describe("governments", () => {
  it("exposes balanced, distinct modifiers", () => {
    const types = Object.keys(GOVERNMENTS);
    expect(types.length).toBeGreaterThanOrEqual(6);
    for (const type of types) {
      const modifiers = modifiersOf(type as keyof typeof GOVERNMENTS);
      expect(modifiers.productionMultiplier).toBeGreaterThan(0.5);
      expect(modifiers.economicMultiplier).toBeGreaterThan(0.5);
      expect(modifiers.populationGrowthMultiplier).toBeGreaterThan(0.5);
      expect(modifiers.stability).toBeGreaterThan(0.5);
    }
    const averageProduction =
      types.reduce((sum, type) => sum + modifiersOf(type as keyof typeof GOVERNMENTS).productionMultiplier, 0) /
      types.length;
    // No regime is dramatically better than the average on the production axis.
    expect(averageProduction).toBeGreaterThan(1);
    expect(averageProduction).toBeLessThan(1.35);
  });

  it("links taxes to income", () => {
    const low = taxFactor(20, modifiersOf("democracy"));
    const high = taxFactor(80, modifiersOf("democracy"));
    expect(high).toBeGreaterThan(low);
  });
});

describe("happiness and discontent", () => {
  it("rises with taxes and wars", () => {
    const modifiers = modifiersOf("democracy");
    const peaceful = computeHappiness(
      { happiness: 60, discontent: 0 },
      { modifiers, balance: DEFAULT_BALANCE, ...BASE_INPUT },
    );
    const taxed = computeHappiness(
      { happiness: 60, discontent: 0 },
      {
        modifiers,
        balance: DEFAULT_BALANCE,
        ...BASE_INPUT,
        taxRate: 90,
      },
    );
    expect(taxed.discontent).toBeGreaterThan(peaceful.discontent);

    const war = computeHappiness(
      { happiness: 60, discontent: 10 },
      {
        modifiers,
        balance: DEFAULT_BALANCE,
        ...BASE_INPUT,
        wars: 2,
      },
    );
    expect(war.discontent).toBeGreaterThan(10);
  });

  it("decays when the nation is at peace", () => {
    const modifiers = modifiersOf("monarchy");
    const result = computeHappiness(
      { happiness: 40, discontent: 40 },
      {
        modifiers,
        balance: DEFAULT_BALANCE,
        ...BASE_INPUT,
        taxRate: 10,
        incomePerTick: 40,
      },
    );
    expect(result.discontent).toBeLessThan(40);
  });

  it("only allows a civil war at 100 % and with enough territory", () => {
    expect(civilWarPossible({ discontent: 99, cooldown: 0, tiles: 100 })).toBe(false);
    expect(civilWarPossible({ discontent: 100, cooldown: 100, tiles: 100 })).toBe(false);
    expect(civilWarPossible({ discontent: 100, cooldown: 0, tiles: 5 })).toBe(false);
    expect(civilWarPossible({ discontent: 100, cooldown: 0, tiles: 100 })).toBe(true);
  });
});

describe("civil war", () => {
  it("creates a seceding nation, hostile to its parent", () => {
    const game = newGame({}, { spawnProtectionTicks: 0 });
    const id = addHuman(game, "A", "Alpha", "dictatorship");
    const player = game.get(id)!;
    for (let tick = 0; tick < 60; tick++) game.advance();
    const before = player.tiles;
    expect(before).toBeGreaterThan(14);

    player.country.discontent = 100;
    player.civilWarCooldown = 0;
    game.advance();

    const rebels = game.allPlayers().find((other) => other.id !== id)!;
    expect(rebels).toBeDefined();
    expect(rebels.tiles).toBeGreaterThan(5);
    expect(player.tiles + rebels.tiles).toBeLessThanOrEqual(before + 8);
    expect(game.relationBetween(id, rebels.id)).not.toBe("neutral");
    expect(isTerritoryConnected(game, rebels.id)).toBe(true);
    const event = game
      .getEvents()
      .recent(20)
      .some((entry) => entry.category === "civil_war" && entry.severity === 3);
    expect(event).toBe(true);
  });
});
