/**
 * Right-click context menu: attack, naval landing, diplomacy, strategic strike
 * and quick construction. Positioned at the cursor and clamped to the viewport.
 */

import {
  BUILDINGS,
  STRATEGIC_WEAPONS,
  TERRAIN_LAND,
  formatNumber,
  type BuildingType,
  type StrategicKind,
} from "@openwars/shared";
import { button, el, setText } from "../dom";
import type { Store } from "../state";
import type { UiActions } from "../actions";


export class ContextMenu {
  readonly root = el("div", { class: "context-menu hidden" });
  private openAt: { x: number; y: number } | null = null;

  constructor(
    private readonly store: Store,
    private readonly actions: UiActions,
  ) {
    document.addEventListener("pointerdown", (event) => {
      if (!this.root.contains(event.target as Node)) this.close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    });
  }

  get isOpen(): boolean {
    return this.openAt !== null;
  }

  close(): void {
    this.openAt = null;
    this.root.classList.add("hidden");
  }

  open(clientX: number, clientY: number, tile: number): void {
    const width = this.store.width;
    if (!width) return;
    this.openAt = { x: clientX, y: clientY };
    this.root.replaceChildren(...this.content(tile));
    this.root.classList.remove("hidden");
    // Measure then clamp inside the viewport.
    const rect = this.root.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 10;
    const maxY = window.innerHeight - rect.height - 10;
    this.root.style.left = `${Math.max(10, Math.min(clientX, maxX))}px`;
    this.root.style.top = `${Math.max(10, Math.min(clientY, maxY))}px`;
  }

  private content(tile: number): HTMLElement[] {
    const store = this.store;
    const actions = this.actions;
    const me = store.me();
    const ownerId = store.ownerAt(tile);
    const owner = store.player(ownerId);
    const building = [...store.buildings.values()].find((candidate) => candidate.tile === tile);
    const x = tile % store.width;
    const y = Math.floor(tile / store.width);
    const terrainValue = store.terrain ? store.terrain[tile] ?? 0 : 0;
    const isLand = terrainValue === TERRAIN_LAND;

    const head = el("div", { class: "context-head" }, [
      el("span", { class: "context-title", text: `Case ${x}, ${y}` }),
      el("span", {
        class: "context-sub",
        text: owner ? `${owner.country.flag} ${owner.country.name}` : isLand ? "Terre inoccupée" : "Océan / lac",
      }),
    ]);
    const children: HTMLElement[] = [head];

    if (building) {
      children.push(
        el("div", { class: "context-info" }, [
          el("span", { text: `${BUILDINGS[building.type].icon} ${BUILDINGS[building.type].label} · niveau ${building.level}` }),
          building.ownerId === store.playerId
            ? button(`Améliorer (${Math.round(BUILDINGS[building.type].upgradeCost)} $)`, () => {
                actions.upgrade(building.id);
                this.close();
              }, { class: "btn small primary" })
            : null,
        ]),
      );
    }

    if (isLand && ownerId !== store.playerId) {
      const troops = me ? Math.floor(me.troops) : 0;
      children.push(
        el("div", { class: "context-section" }, [
          el("span", { class: "context-section-title", text: owner ? "Invasion" : "Colonisation" }),
          el("div", { class: "context-buttons" }, [
            button(`⚔️ Attaquer (50 %)`, () => {
              actions.attack(x, y, Math.floor(troops * 0.5));
              this.close();
            }, { class: "btn small primary", disabled: troops < 20 }),
            button(`⚔️ Tout (${formatNumber(troops)})`, () => {
              actions.attack(x, y);
              this.close();
            }, { class: "btn small", disabled: troops < 20 }),
          ]),
        ]),
      );
    }

    if (isLand && ownerId === store.playerId) {
      const quick: BuildingType[] = ["city", "factory", "port", "fort", "road"];
      const buttons = quick.map((type) =>
        button(`${BUILDINGS[type].icon} ${BUILDINGS[type].label}`, () => {
          actions.build(type, x, y);
          this.close();
        }, {
          class: "btn small",
          disabled: me ? me.money < BUILDINGS[type].cost : true,
        }),
      );
      children.push(
        el("div", { class: "context-section" }, [
          el("span", { class: "context-section-title", text: "Construire ici" }),
          el("div", { class: "context-buttons wrap" }, buttons),
        ]),
      );
    }

    if (owner && ownerId !== store.playerId) {
      const relation = store.relationWith(ownerId);
      const diploButtons: HTMLElement[] = [];
      if (relation === "ally") {
        diploButtons.push(
          button("💰 250 $", () => {
            actions.gift(ownerId, "money", 250);
            this.close();
          }, { class: "btn small" }),
          button("🎖️ 100", () => {
            actions.gift(ownerId, "troops", 100);
            this.close();
          }, { class: "btn small" }),
          button("Rompre l'alliance", () => {
            actions.breakAlliance();
            this.close();
          }, { class: "btn small danger" }),
        );
      } else if (relation === "neutral") {
        diploButtons.push(
          button("🤝 Proposer une alliance", () => {
            actions.requestAlliance(ownerId);
            this.close();
          }, { class: "btn small primary" }),
        );
      } else {
        diploButtons.push(el("span", { class: "context-info", text: "En guerre" }));
      }
      children.push(
        el("div", { class: "context-section" }, [
          el("span", { class: "context-section-title", text: "Diplomatie" }),
          el("div", { class: "context-buttons wrap" }, diploButtons),
        ]),
      );
    }

    if (me?.unlocks.naval && isLand) {
      children.push(
        el("div", { class: "context-section" }, [
          el("span", { class: "context-section-title", text: "Marine" }),
          el("div", { class: "context-buttons" }, [
            button("⛵ Débarquement", () => {
              actions.marineStrike(x, y, 150, "transport");
              this.close();
            }, { class: "btn small" }),
            button("🚢 Bateau de guerre", () => {
              actions.marineStrike(x, y, 0, "warship");
              this.close();
            }, { class: "btn small" }),
          ]),
        ]),
      );
    }

    if (me?.unlocks.strategic) {
      const weapons = (Object.keys(STRATEGIC_WEAPONS) as StrategicKind[]).map((kind) => {
        const spec = STRATEGIC_WEAPONS[kind];
        const cooldown = me.cooldowns[kind];
        return button(
          `${spec.icon} ${spec.label}${cooldown > 0 ? ` (${Math.ceil(cooldown / 10)} s)` : ` · ${spec.cost} $`}`,
          () => {
            actions.missile(kind, x, y);
            this.close();
          },
          { class: "btn small danger", disabled: cooldown > 0 || me.money < spec.cost },
        );
      });
      children.push(
        el("div", { class: "context-section" }, [
          el("span", { class: "context-section-title", text: "Frappe stratégique" }),
          el("div", { class: "context-buttons wrap" }, weapons),
        ]),
      );
    }

    children.push(
      el("div", { class: "context-footer" }, [
        button("Recentrer", () => {
          actions.centerOn(tile);
          this.close();
        }, { class: "btn small ghost" }),
      ]),
    );
    return children;
  }
}

export function updateContextHint(node: HTMLElement, text: string): void {
  setText(node, text);
}
