// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameImpl } from "../../../packages/engine/src/game/GameImpl";
import { Store } from "../state";
import { Ui } from "../ui/index";
import { MapRenderer } from "../render";
import type { TargetMode, UiActions } from "../actions";
import type { GiftKind, GovernmentType } from "@openwars/shared";

/** Minimal 2D context stub: jsdom has no canvas backend. */
function stubContext(): CanvasRenderingContext2D {
  const context = {
    canvas: null as unknown as HTMLCanvasElement,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: () => undefined,
    fillText: () => undefined,
    measureText: (text: string) => ({ width: text.length * 6 }),
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    setTransform: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    arcTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
  };
  return context as unknown as CanvasRenderingContext2D;
}

function fakeGame(): GameImpl {
  const game = new GameImpl({
    width: 120,
    height: 90,
    seed: 11,
    maxPlayers: 3,
    bots: 2,
    tickRate: 10,
    mapStyle: "continents",
  });
  game.addPlayer({
    name: "Benjamin",
    countryName: "France",
    flag: "🇫🇷",
    color: "#3b6bd6",
    government: "republic",
    isBot: false,
  });
  for (let tick = 0; tick < 120; tick++) game.advance();
  return game;
}

function stubActions(modeRef: { current: TargetMode }): UiActions {
  const noop = (): void => undefined;
  return {
    attack: noop,
    build: noop,
    upgrade: noop,
    marineStrike: noop,
    missile: noop,
    requestAlliance: noop,
    respondAlliance: noop,
    breakAlliance: noop,
    gift: (_t: number, _k: GiftKind, _a: number) => undefined,
    setTransferSettings: noop,
    setGovernment: (_g: GovernmentType) => undefined,
    setTax: noop,
    centerOn: noop,
    focusCapital: noop,
    openPanel: noop,
    notify: noop,
    getMode: () => modeRef.current,
    setMode: (mode) => {
      modeRef.current = mode;
    },
  };
}

describe("client UI", () => {
  let game: GameImpl;
  let store: Store;

  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    game = fakeGame();
    store = new Store();
    store.applySnapshot(game.snapshot());
    store.playerId = 1;
  });

  it("renders the HUD with the player's country", () => {
    const mode = { current: { kind: "none" } as TargetMode };
    const ui = new Ui(store, stubActions(mode), () => undefined, () => undefined);
    ui.mount(document.getElementById("ui") as HTMLElement);
    ui.showGame(true);
    ui.update();
    expect(document.body.textContent).toContain("France");
    expect(document.body.textContent).toContain("Nations");
    expect(document.body.textContent).toContain("Construire");
  });

  it("applies tile updates to the mirror state", () => {
    const before = store.ownerAt(game.get(1)!.capital);
    expect(before).toBe(1);
    const other = game.get(1)!;
    game.setTileOwner(0, 0);
    store.applyUpdate(game.advance());
    expect(store.tick).toBeGreaterThan(0);
    expect(other.tiles).toBeGreaterThan(0);
    expect(store.players.size).toBeGreaterThanOrEqual(1);
  });

  it("opens panels and the context menu without throwing", () => {
    const mode = { current: { kind: "none" } as TargetMode };
    const actions = stubActions(mode);
    const ui = new Ui(store, actions, () => undefined, () => undefined);
    ui.mount(document.getElementById("ui") as HTMLElement);
    ui.showGame(true);
    ui.panels.open("build");
    expect(ui.panels.root.textContent).toContain("Construire");
    ui.panels.open("politics");
    expect(ui.panels.root.textContent).toContain("Régimes");
    ui.panels.open("diplomacy");
    expect(ui.panels.root.textContent).toContain("Diplomatie");
    ui.panels.open("military");
    expect(ui.panels.root.textContent).toContain("Marine");
    ui.panels.open("help");
    expect(ui.panels.root.textContent).toContain("Contrôles");

    const tile = game.get(1)!.capital;
    ui.contextMenu.open(100, 100, tile);
    expect(ui.contextMenu.root.classList.contains("hidden")).toBe(false);
    expect(ui.contextMenu.root.textContent).toContain("Construire ici");
    ui.contextMenu.close();
    expect(ui.contextMenu.root.classList.contains("hidden")).toBe(true);
  });

  it("pushes ticker and notification entries", () => {
    const mode = { current: { kind: "none" } as TargetMode };
    const ui = new Ui(store, stubActions(mode), () => undefined, () => undefined);
    ui.mount(document.getElementById("ui") as HTMLElement);
    const update = game.advance();
    ui.pushEvents(update.events);
    ui.pushNotifications(update.notifications);
    ui.notifications.info("test");
    expect(document.body.textContent).toContain("test");
  });
});

describe("client renderer", () => {
  beforeEach(() => {
    // jsdom has no canvas backend: every canvas gets the stub context.
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => stubContext(),
    });
  });

  it("paints terrain, ownership and vectors", () => {
    const game = fakeGame();
    const store = new Store();
    store.applySnapshot(game.snapshot());
    store.playerId = 1;

    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 800 });
    Object.defineProperty(canvas, "clientHeight", { value: 600 });

    const renderer = new MapRenderer(canvas, store);
    renderer.resize();
    renderer.fit();
    renderer.refreshTerrain();
    renderer.refreshOwnership();
    renderer.hover = { x: 10, y: 10 };
    renderer.ghost = "city";
    renderer.draw();
    renderer.zoomAt(400, 300, 1.2);
    renderer.pan(10, 10);
    renderer.draw();

    const tile = renderer.screenToTile(400, 300);
    expect(tile.x).toBeGreaterThan(0);
    expect(tile.y).toBeGreaterThan(0);
    expect(renderer.scale).toBeGreaterThan(0);
  });
});
