/** Top bar widgets: event ticker, notifications, nation HUD, scoreboard, dock. */

import {
  EVENT_CATEGORY_COLORS,
  GOVERNMENTS,
  formatMoney,
  formatNumber,
  type PlayerState,
  type WorldEvent,
} from "@openwars/shared";
import { bar, button, el, setText } from "../dom";
import type { Store } from "../state";
import type { UiActions, PanelName } from "../actions";

export class Ticker {
  readonly root = el("div", { class: "ticker", title: "Événements mondiaux" });
  private readonly track = el("div", { class: "ticker-track" });
  private hovered = false;
  private seen = new Set<number>();

  constructor() {
    this.root.append(this.track);
    this.root.addEventListener("mouseenter", () => {
      this.hovered = true;
    });
    this.root.addEventListener("mouseleave", () => {
      this.hovered = false;
    });
  }

  push(events: readonly WorldEvent[]): void {
    let added = 0;
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (added >= 6) break; // do not flood a single frame
      added++;
      const chip = el("div", { class: `ticker-chip sev-${event.severity}` });
      const dot = el("span", { class: "ticker-dot" });
      dot.style.background = EVENT_CATEGORY_COLORS[event.category] ?? "#9aa6b2";
      chip.append(dot, el("span", { text: event.message }));
      this.track.append(chip);
      this.root.scrollLeft = this.root.scrollWidth;
    }
    while (this.track.childElementCount > 40) {
      this.track.firstElementChild?.remove();
    }
  }

  frame(): void {
    if (this.hovered) return;
    if (this.root.scrollWidth <= this.root.clientWidth) return;
    this.root.scrollLeft += 0.45;
  }
}

export class Notifications {
  readonly root = el("div", { class: "notifications" });

  push(event: WorldEvent): void {
    const toast = el("div", { class: "toast" });
    const color = EVENT_CATEGORY_COLORS[event.category] ?? "#9aa6b2";
    const accent = el("span", { class: "toast-accent" });
    accent.style.background = color;
    toast.append(accent, el("span", { text: event.message }));
    this.root.append(toast);
    window.setTimeout(() => {
      toast.classList.add("leaving");
      window.setTimeout(() => toast.remove(), 400);
    }, 6500);
    while (this.root.childElementCount > 4) this.root.firstElementChild?.remove();
  }

  info(message: string): void {
    this.push({
      id: Math.random(),
      tick: 0,
      category: "system",
      severity: 3,
      message,
      players: [],
    });
  }

  error(message: string): void {
    const toast = el("div", { class: "toast error" });
    toast.append(el("span", { class: "toast-accent" }), el("span", { text: message }));
    this.root.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
    while (this.root.childElementCount > 4) this.root.firstElementChild?.remove();
  }
}

export class Hud {
  readonly root = el("div", { class: "panel hud" });
  private readonly flag = el("span", { class: "hud-flag" });
  private readonly country = el("span", { class: "hud-country" });
  private readonly leader = el("span", { class: "hud-leader" });
  private readonly government = el("span", { class: "hud-government" });
  private readonly money = el("span", { class: "hud-value" });
  private readonly income = el("span", { class: "hud-sub" });
  private readonly population = el("span", { class: "hud-value" });
  private readonly troops = el("span", { class: "hud-value" });
  private readonly tiles = el("span", { class: "hud-value" });
  private readonly happinessBar: HTMLElement;
  private readonly discontentBar: HTMLElement;
  private readonly happinessLabel = el("span", { class: "hud-bar-label" });
  private readonly discontentLabel = el("span", { class: "hud-bar-label" });
  private readonly clock = el("span", { class: "hud-clock" });
  private readonly online = el("span", { class: "hud-online" });

  constructor(private readonly store: Store, actions: UiActions) {
    const header = el("div", { class: "hud-header" }, [
      this.flag,
      el("div", { class: "hud-title" }, [
        this.country,
        el("div", { class: "hud-subtitle" }, [this.leader, this.government]),
      ]),
    ]);
    header.addEventListener("click", () => actions.focusCapital());
    this.happinessBar = bar(50, 100, "happiness");
    this.discontentBar = bar(0, 100, "discontent");
    const stats = el("div", { class: "hud-stats" }, [
      stat("💰", this.money, this.income),
      stat("👥", this.population),
      stat("🎖️", this.troops),
      stat("🗺️", this.tiles),
    ]);
    const bars = el("div", { class: "hud-bars" }, [
      el("div", { class: "hud-bar-row" }, [
        el("span", { text: "Bonheur" }),
        this.happinessBar,
        this.happinessLabel,
      ]),
      el("div", { class: "hud-bar-row" }, [
        el("span", { text: "Mécontentement" }),
        this.discontentBar,
        this.discontentLabel,
      ]),
    ]);
    const footer = el("div", { class: "hud-footer" }, [this.clock, this.online]);
    this.root.append(header, stats, bars, footer);
  }

  update(): void {
    const player = this.store.me();
    if (!player) {
      setText(this.country, this.store.playerId === 0 ? "Spectateur" : "En attente…");
      setText(this.leader, "");
      return;
    }
    setText(this.flag, player.country.flag);
    setText(this.country, player.country.name);
    setText(this.leader, player.name);
    const government = GOVERNMENTS[player.country.government];
    setText(this.government, ` · ${government.icon} ${government.label}`);
    setText(this.money, formatMoney(player.money));
    setText(this.income, `${player.incomePerTick >= 0 ? "+" : ""}${(player.incomePerTick * (1000 / this.store.tickIntervalMs)).toFixed(1)}/s`);
    setText(this.population, formatNumber(player.population));
    setText(this.troops, `${formatNumber(player.troops)} / ${formatNumber(player.maxTroops)}`);
    setText(this.tiles, formatNumber(player.tiles));

    const happinessBar = this.happinessBar.firstElementChild as HTMLElement | null;
    if (happinessBar) happinessBar.style.width = `${player.country.happiness}%`;
    const discontentBar = this.discontentBar.firstElementChild as HTMLElement | null;
    if (discontentBar) discontentBar.style.width = `${player.country.discontent}%`;
    setText(this.happinessLabel, `${Math.round(player.country.happiness)} %`);
    setText(this.discontentLabel, `${Math.round(player.country.discontent)} %`);
    this.root.classList.toggle("risk", player.country.discontent > 75);

    setText(this.clock, `⏱ ${Math.floor(this.store.tick / 10 / 60)}:${String(Math.floor(this.store.tick / 10) % 60).padStart(2, "0")}`);
    const humans = [...this.store.players.values()].filter((other) => !other.isBot && other.alive).length;
    setText(this.online, `${humans} humain(s) · ${this.store.players.size} nations`);
  }
}

function stat(icon: string, value: HTMLElement, sub?: HTMLElement): HTMLElement {
  return el("div", { class: "hud-stat" }, [
    el("span", { class: "hud-icon", text: icon }),
    el("div", { class: "hud-stat-body" }, [value, sub ?? null]),
  ]);
}

export class Scoreboard {
  readonly root = el("div", { class: "panel scoreboard" });
  private readonly list = el("div", { class: "scoreboard-list" });
  private readonly title = el("div", { class: "panel-title", text: "Nations" });

  constructor(
    private readonly store: Store,
    private readonly actions: UiActions,
  ) {
    this.root.append(this.title, this.list);
  }

  update(): void {
    const players = [...this.store.players.values()]
      .filter((player) => player.alive)
      .sort((a, b) => b.score - a.score);
    const rows = players.map((player) => this.row(player));
    this.list.replaceChildren(...rows);
    setText(this.title, `Nations · ${players.length}`);
  }

  private row(player: PlayerState): HTMLElement {
    const mine = player.id === this.store.playerId;
    const relation = this.store.relationWith(player.id);
    const row = el("div", { class: `score-row${mine ? " mine" : ""}` });
    const chip = el("span", { class: "score-chip" });
    chip.style.background = player.country.color;
    const name = el("div", { class: "score-name" }, [
      el("span", { text: `${player.country.flag} ${player.country.name}` }),
      el("span", { class: "score-sub", text: `${formatNumber(player.tiles)} cases · ${formatNumber(player.troops)} 🎖️` }),
    ]);
    const badge = el("span", {
      class: "score-badge",
      text: relation === "ally" ? "🤝" : relation === "war" || relation === "civil_war" ? "⚔️" : player.isBot ? "🤖" : "",
    });
    row.append(chip, name, badge);
    row.addEventListener("click", () => this.actions.centerOn(player.capital));
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.actions.openPanel("diplomacy");
    });
    return row;
  }
}

export class Dock {
  readonly root = el("div", { class: "panel dock" });

  constructor(actions: UiActions) {
    const entries: Array<{ panel: PanelName; icon: string; label: string }> = [
      { panel: "build", icon: "🏗️", label: "Construire" },
      { panel: "politics", icon: "🏛️", label: "Politique" },
      { panel: "diplomacy", icon: "🤝", label: "Diplomatie" },
      { panel: "military", icon: "🚀", label: "Armement" },
      { panel: "help", icon: "❔", label: "Aide" },
    ];
    for (const entry of entries) {
      const element = button(entry.label, () => actions.openPanel(entry.panel), {
        class: "dock-button",
        title: entry.label,
      });
      element.prepend(el("span", { class: "dock-icon", text: entry.icon }));
      this.root.append(element);
    }
  }
}
