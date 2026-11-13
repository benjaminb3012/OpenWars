// @vitest-environment jsdom
/**
 * End-to-end smoke test of the browser entry point.
 *
 * A fake WebSocket replays a real engine snapshot/update stream from a real
 * GameImpl, so the test exercises the actual main.ts wiring: menu, join, HUD,
 * map clicks and intent sending.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { GameImpl } from "../../../packages/engine/src/game/GameImpl";
import type { ClientMessage, GameSnapshot } from "@openwars/shared";

const game = new GameImpl({
  width: 140,
  height: 100,
  seed: 5,
  maxPlayers: 3,
  bots: 1,
  tickRate: 10,
  mapStyle: "continents",
});

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = 1;
  sent: ClientMessage[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor() {
    sockets.push(this);
    setTimeout(() => {
      this.onopen?.({});
      this.deliver({ t: "welcome", playerId: 0, snapshot: game.snapshot() });
    }, 0);
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as ClientMessage;
    this.sent.push(message);
    if (message.t === "join") {
      const result = game.addPlayer({
        name: message.name,
        countryName: message.countryName,
        flag: message.flag,
        color: message.color,
        government: message.government,
        isBot: false,
      });
      if (result.ok) {
        setTimeout(() => {
          this.deliver({ t: "welcome", playerId: result.id, snapshot: game.snapshot() });
        }, 0);
      } else {
        this.deliver({ t: "error", message: result.error });
      }
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubCanvas(): CanvasRenderingContext2D {
  const context = {
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

beforeAll(async () => {
  document.body.innerHTML = '<canvas id="map"></canvas><div id="ui"></div>';
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => stubCanvas(),
  });
  const canvas = document.getElementById("map") as HTMLCanvasElement;
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 600 });
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  await import("../main");
  await wait(60);
});

describe("browser entry point", () => {
  it("connects and shows the nation menu", () => {
    expect(sockets.length).toBe(1);
    const text = document.body.textContent ?? "";
    expect(text).toContain("OpenWars");
    expect(text).toContain("Rejoindre la partie");
    expect(text).toContain("République");
  });

  it("joins a nation and shows the HUD", async () => {
    const joinButton = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Rejoindre la partie"),
    ) as HTMLButtonElement | undefined;
    expect(joinButton).toBeDefined();
    joinButton!.click();
    await wait(80);

    const socket = sockets[0]!;
    expect(socket.sent.some((message) => message.t === "join")).toBe(true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Dirigeant");
    expect(text).toContain("Nations");
    expect(text).toContain("Construire");
  });

  it("sends an attack intent when the map is clicked", async () => {
    const socket = sockets[0]!;
    const before = socket.sent.filter((message) => message.t === "attack").length;
    const canvas = document.getElementById("map") as HTMLCanvasElement;
    const event = new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true });
    Object.defineProperty(event, "pointerId", { value: 1 });
    canvas.dispatchEvent(event);
    const up = new MouseEvent("pointerup", { clientX: 400, clientY: 300, button: 0, bubbles: true });
    Object.defineProperty(up, "pointerId", { value: 1 });
    canvas.dispatchEvent(up);
    await wait(20);
    const attacks = socket.sent.filter((message) => message.t === "attack").length;
    expect(attacks).toBe(before + 1);
  });

  it("applies server updates to the HUD", async () => {
    const socket = sockets[0]!;
    expect(socket.deliver).toBeTypeOf("function");
    const update = game.advance();
    sockets[0]!.deliver({ t: "update", update });
    await wait(30);
    const player = game.get(1);
    expect(player).toBeDefined();
    expect(document.body.textContent ?? "").toContain(player!.country.name);
  });

  it("opens panels from the dock and the context menu", async () => {
    const buttons = [...document.querySelectorAll("button")];
    const buildButton = buttons.find((element) => element.textContent?.includes("Construire"));
    expect(buildButton).toBeDefined();
    buildButton!.click();
    await wait(20);
    expect(document.body.textContent ?? "").toContain("Bâtiments");

    const canvas = document.getElementById("map") as HTMLCanvasElement;
    const down = new MouseEvent("pointerdown", { clientX: 420, clientY: 260, button: 2, bubbles: true });
    Object.defineProperty(down, "pointerId", { value: 2 });
    canvas.dispatchEvent(down);
    const up = new MouseEvent("pointerup", { clientX: 420, clientY: 260, button: 2, bubbles: true });
    Object.defineProperty(up, "pointerId", { value: 2 });
    canvas.dispatchEvent(up);
    await wait(20);
    expect(document.body.textContent ?? "").toContain("Case");
  });
});

void ({} as GameSnapshot);
