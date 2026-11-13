/** Application entry point: input handling, networking and the render loop. */

import {
  BUILDINGS,
  GOVERNMENTS,
  TERRAIN_LAND,
  TERRAIN_LAKE,
  TERRAIN_OCEAN,
  type ClientMessage,
  type GiftKind,
  type GovernmentType,
  type StrategicKind,
} from "@openwars/shared";
import { Store } from "./state";
import { Net } from "./net";
import { MapRenderer } from "./render";
import { Ui } from "./ui/index";
import type { UiActions, TargetMode } from "./actions";

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
const uiRoot = document.getElementById("ui") as HTMLElement | null;
if (!canvas || !uiRoot) throw new Error("DOM incomplet");

const store = new Store();
const renderer = new MapRenderer(canvas, store);
let mode: TargetMode = { kind: "none" };
let joinedOnce = false;
let ownershipDirty = true;

const net = new Net({
  onWelcome: (message) => {
    store.applySnapshot(message.snapshot);
    store.playerId = message.playerId;
    renderer.refreshTerrain();
    renderer.refreshOwnership();
    ownershipDirty = false;
    if (!joinedOnce && message.playerId === 0) {
      // Initial spectator snapshot: keep the menu open, just refresh the preview.
      ui.update();
      return;
    }
    joinedOnce = true;
    ui.showGame(true);
    ui.update();
    const me = store.me();
    if (me) {
      renderer.fit();
      renderer.centerOn(me.capital);
      ui.notifications.info(
        `${me.country.flag} ${me.country.name} — ${GOVERNMENTS[me.country.government].label}. À toi de jouer !`,
      );
    } else {
      renderer.fit();
      ui.setStatus("Mode observateur", true);
    }
    ui.pushEvents(store.recentEvents.slice(-12));
  },
  onUpdate: (message) => {
    store.applyUpdate(message.update);
    ownershipDirty = true;
    ui.update();
    ui.pushEvents(message.update.events);
    ui.pushNotifications(message.update.notifications);
  },
  onError: (message) => {
    ui.notifications.error(message);
    ui.menu.setStatus(message, "error");
  },
  onInfo: (message) => {
    ui.notifications.info(message);
  },
  onStatus: (connected) => {
    store.connected = connected;
    ui.menu.setConnected(connected);
    ui.setStatus(connected ? "" : "Connexion perdue — reconnexion…", !connected);
  },
});

const send = (message: ClientMessage): void => {
  net.send(message);
  void message;
};

const actions: UiActions = {
  attack: (x, y, troops) => send({ t: "attack", x, y, troops }),
  build: (type, x, y) => send({ t: "build", building: type, x, y }),
  upgrade: (buildingId) => send({ t: "upgrade", buildingId }),
  marineStrike: (x, y, troops, kind) => send({ t: "boat", x, y, troops, kind }),
  missile: (kind: StrategicKind, x, y) => send({ t: "missile", kind, x, y }),
  requestAlliance: (target) => send({ t: "alliance", target }),
  respondAlliance: (from, accept) => send({ t: "allianceResponse", from, accept }),
  breakAlliance: () => send({ t: "breakAlliance" }),
  gift: (target, kind: GiftKind, amount) => send({ t: "gift", target, kind, amount }),
  setTransferSettings: (moneyPercentage, troopPercentage) =>
    send({ t: "transferSettings", moneyPercentage, troopPercentage }),
  setGovernment: (government: GovernmentType) => send({ t: "government", government }),
  setTax: (rate) => send({ t: "tax", rate }),
  centerOn: (tile) => renderer.centerOn(tile),
  focusCapital: () => {
    const me = store.me();
    if (me) renderer.centerOn(me.capital);
  },
  openPanel: (panel) => ui.panels.open(panel),
  notify: (message) => ui.notifications.info(message),
  getMode: () => mode,
  setMode: (next) => {
    mode = next;
    renderer.ghost = next.kind === "build" ? next.building : null;
    ui.setGhostBanner();
    ui.update();
  },
};

const ui = new Ui(
  store,
  actions,
  (payload) => {
    const message: ClientMessage = {
      t: "join",
      name: payload.name,
      countryName: payload.countryName,
      flag: payload.flag,
      color: payload.color,
      government: payload.government,
    };
    net.join(message);
    ui.menu.setStatus("Connexion à la nation…");
  },
  () => {
    joinedOnce = true;
    net.send({ t: "spectate" });
    ui.showGame(true);
    renderer.fit();
    ui.setStatus("Mode observateur", true);
  },
);
ui.mount(uiRoot);
ui.setGhostBanner();

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
  dragged: boolean;
}

const pointers = new Map<number, PointerState>();
let pinchDistance = 0;

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    button: event.button,
    dragged: false,
  });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    if (a && b) pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener("pointermove", (event) => {
  const pointer = pointers.get(event.pointerId);
  if (pointer) {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 6) {
      pointer.dragged = true;
    }
    if (pointers.size === 1 && (pointer.button === 2 || pointer.button === 1 || pointer.dragged && pointer.button === 0 && event.shiftKey)) {
      renderer.pan(dx, dy);
    } else if (pointers.size === 1 && pointer.dragged && pointer.button === 0 && mode.kind === "none" && event.pointerType !== "mouse") {
      // Touch drag pans the map.
      renderer.pan(dx, dy);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) {
          renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / pinchDistance);
        }
        pinchDistance = distance;
      }
    }
  }

  const tile = renderer.screenToTile(event.clientX, event.clientY);
  if (tile.x < 0 || tile.y < 0 || tile.x >= store.width || tile.y >= store.height) {
    renderer.hover = null;
    ui.hideTooltip();
    return;
  }
  renderer.hover = { x: tile.x, y: tile.y };
  const index = tile.y * store.width + tile.x;
  ui.showTooltip(event.clientX, event.clientY, describeTile(index, tile.x, tile.y));
});

canvas.addEventListener("pointerup", (event) => {
  const pointer = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (!pointer) return;
  const tile = renderer.screenToTile(event.clientX, event.clientY);
  const inside =
    tile.x >= 0 && tile.y >= 0 && tile.x < store.width && tile.y < store.height;
  if (!inside || pointer.dragged) return;
  const index = tile.y * store.width + tile.x;
  if (pointer.button === 2) {
    ui.contextMenu.open(event.clientX, event.clientY, index);
    return;
  }
  if (pointer.button !== 0) return;
  primaryAction(index);
});

canvas.addEventListener("pointercancel", (event) => {
  pointers.delete(event.pointerId);
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    renderer.zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 0.87);
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    actions.setMode({ kind: "none" });
    ui.panels.open(null);
    ui.contextMenu.close();
  }
});

window.addEventListener("resize", () => {
  renderer.resize();
});

// ---------------------------------------------------------------------------
// Main actions
// ---------------------------------------------------------------------------

function primaryAction(tile: number): void {
  const me = store.me();
  if (!me) {
    ui.notifications.error("Choisis d'abord une nation.");
    return;
  }
  const x = tile % store.width;
  const y = Math.floor(tile / store.width);
  switch (mode.kind) {
    case "build": {
      actions.build(mode.building, x, y);
      if (mode.building !== "road") actions.setMode({ kind: "none" });
      break;
    }
    case "missile": {
      actions.missile(mode.weapon, x, y);
      actions.setMode({ kind: "none" });
      break;
    }
    case "boat": {
      actions.marineStrike(x, y, 150, mode.boat);
      actions.setMode({ kind: "none" });
      break;
    }
    default: {
      // 50 % of the army is the default commitment for a left click, the
      // context menu offers an explicit all-in.
      const troops = Math.floor((me.troops ?? 0) * 0.5);
      actions.attack(x, y, troops);
    }
  }
}

function describeTile(index: number, x: number, y: number): string {
  const terrain = store.terrain ? store.terrain[index] ?? TERRAIN_OCEAN : TERRAIN_OCEAN;
  const ownerId = store.ownerAt(index);
  const owner = store.player(ownerId);
  const building = [...store.buildings.values()].find((candidate) => candidate.tile === index);
  const parts = [`${x}, ${y} · ${terrain === TERRAIN_LAND ? "terre" : terrain === TERRAIN_LAKE ? "lac" : "océan"}`];
  if (owner) parts.push(`${owner.country.flag} ${owner.country.name}`);
  if (building) parts.push(`${BUILDINGS[building.type].icon} ${BUILDINGS[building.type].label} n.${building.level}`);
  if (store.scorch.has(index)) parts.push("☢️ zone dévastée");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function frame(): void {
  if (ownershipDirty && store.owner) {
    renderer.refreshOwnership();
    ownershipDirty = false;
  }
  renderer.draw();
  ui.frame();
  requestAnimationFrame(frame);
}

renderer.resize();
net.connect();
requestAnimationFrame(frame);
