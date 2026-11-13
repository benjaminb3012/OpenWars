/** Root UI composition: ties the widgets together and owns transient state. */

import { BUILDINGS, type WorldEvent } from "@openwars/shared";
import { el, setText } from "../dom";
import type { Store } from "../state";
import type { UiActions } from "../actions";
import { Dock, Hud, Notifications, Scoreboard, Ticker } from "./hud";
import { PanelHost } from "./panels";
import { ContextMenu } from "./contextMenu";
import { NationMenu, type JoinPayload } from "./menu";

export class Ui {
  readonly root = el("div", { class: "ui-root" });
  readonly ticker = new Ticker();
  readonly notifications = new Notifications();
  readonly hud: Hud;
  readonly scoreboard: Scoreboard;
  readonly dock: Dock;
  readonly panels: PanelHost;
  readonly contextMenu: ContextMenu;
  readonly menu: NationMenu;
  private readonly banner = el("div", { class: "mode-banner hidden" });
  private readonly tooltip = el("div", { class: "tooltip hidden" });
  private readonly statusPill = el("div", { class: "status-pill hidden" });

  constructor(
    private readonly store: Store,
    private readonly actions: UiActions,
    onJoin: (payload: JoinPayload) => void,
    onSpectate: () => void,
  ) {
    this.hud = new Hud(store, actions);
    this.scoreboard = new Scoreboard(store, actions);
    this.dock = new Dock(actions);
    this.panels = new PanelHost(store, actions);
    this.contextMenu = new ContextMenu(store, actions);
    this.menu = new NationMenu(store, onJoin, onSpectate);
    this.dock.root.classList.add("hidden");

    this.root.append(
      this.ticker.root,
      this.hud.root,
      this.scoreboard.root,
      this.dock.root,
      this.panels.root,
      this.banner,
      this.notifications.root,
      this.tooltip,
      this.statusPill,
      this.contextMenu.root,
      this.menu.root,
    );
    this.hud.root.classList.add("hidden");
    this.scoreboard.root.classList.add("hidden");
    this.menu.show();
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
  }

  showGame(show: boolean): void {
    this.hud.root.classList.toggle("hidden", !show);
    this.scoreboard.root.classList.toggle("hidden", !show);
    this.dock.root.classList.toggle("hidden", !show);
    if (!show) {
      this.panels.open(null);
      this.contextMenu.close();
    }
    this.menu.root.classList.toggle("hidden", show);
  }

  setGhostBanner(): void {
    const mode = this.actions.getMode();
    if (mode.kind === "build") {
      this.banner.classList.remove("hidden");
      setText(
        this.banner,
        `Placement : ${BUILDINGS[mode.building].icon} ${BUILDINGS[mode.building].label} · clic pour construire · Échap pour annuler`,
      );
    } else if (mode.kind === "missile") {
      this.banner.classList.remove("hidden");
      setText(this.banner, "Frappe stratégique · clique sur la cible · Échap pour annuler");
    } else if (mode.kind === "boat") {
      this.banner.classList.remove("hidden");
      setText(this.banner, "Opération navale · clique sur une côte · Échap pour annuler");
    } else {
      this.banner.classList.add("hidden");
    }
  }

  setStatus(text: string, visible = true): void {
    this.statusPill.classList.toggle("hidden", !visible);
    setText(this.statusPill, text);
  }

  update(): void {
    this.hud.update();
    this.scoreboard.update();
    this.panels.update();
    this.menu.update();
  }

  frame(): void {
    this.ticker.frame();
  }

  pushEvents(events: readonly WorldEvent[]): void {
    if (events.length === 0) return;
    this.ticker.push(events);
  }

  pushNotifications(events: readonly WorldEvent[]): void {
    for (const event of events) {
      if (this.store.playerId !== 0) {
        const concernsMe =
          event.players.length === 0 ||
          event.players.includes(this.store.playerId) ||
          event.severity >= 3;
        if (!concernsMe) continue;
      }
      this.notifications.push(event);
    }
  }

  showTooltip(clientX: number, clientY: number, text: string): void {
    this.tooltip.classList.remove("hidden");
    setText(this.tooltip, text);
    this.tooltip.style.left = `${clientX + 14}px`;
    this.tooltip.style.top = `${clientY + 14}px`;
  }

  hideTooltip(): void {
    this.tooltip.classList.add("hidden");
  }
}
