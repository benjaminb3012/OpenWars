/** Side sheet: construction, politics, diplomacy, strategic assets and help. */

import {
  BUILDINGS,
  BUILDING_TYPES,
  GOVERNMENTS,
  GOVERNMENT_TYPES,
  STRATEGIC_WEAPONS,
  formatMoney,
  formatNumber,
  type BuildingType,
  type GovernmentType,
  type StrategicKind,
} from "@openwars/shared";
import { bar, button, el, setText } from "../dom";
import type { Store } from "../state";
import type { PanelName, UiActions } from "../actions";

export class PanelHost {
  readonly root = el("div", { class: "panel sheet hidden" });
  private readonly title = el("div", { class: "panel-title" });
  private readonly close = button("✕", () => this.open(null), { class: "sheet-close" });
  private readonly body = el("div", { class: "sheet-body" });
  private readonly header = el("div", { class: "sheet-header" }, [this.title, this.close]);
  private current: PanelName | null = null;
  private lastRender = 0;

  constructor(
    private readonly store: Store,
    private readonly actions: UiActions,
  ) {
    this.root.append(this.header, this.body);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(panel: PanelName | null): void {
    this.current = panel;
    this.root.classList.toggle("hidden", panel === null);
    if (panel) this.render(true);
  }

  update(): void {
    if (!this.current) return;
    const now = performance.now();
    if (now - this.lastRender < 350) return;
    const active = document.activeElement;
    if (active && this.root.contains(active) && active !== document.body) return;
    this.render(false);
  }

  private render(force: boolean): void {
    if (!this.current) return;
    this.lastRender = performance.now();
    const content = buildContent(this.current, this.store, this.actions, force);
    setText(this.title, content.title);
    this.body.replaceChildren(...content.children);
  }
}

interface PanelContent {
  title: string;
  children: HTMLElement[];
}

function buildContent(
  panel: PanelName,
  store: Store,
  actions: UiActions,
  force: boolean,
): PanelContent {
  switch (panel) {
    case "build":
      return buildPanel(store, actions);
    case "politics":
      return politicsPanel(store, actions);
    case "diplomacy":
      return diplomacyPanel(store, actions);
    case "military":
      return militaryPanel(store, actions);
    case "help":
      return helpPanel(force);
  }
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  return el("div", { class: "sheet-section" }, [
    el("div", { class: "sheet-section-title", text: title }),
    ...children,
  ]);
}

function buildPanel(store: Store, actions: UiActions): PanelContent {
  const me = store.me();
  const mode = actions.getMode();
  const counts = countBuildings(store);
  const cards: HTMLElement[] = [];
  for (const type of BUILDING_TYPES) {
    const spec = BUILDINGS[type];
    const affordable = me ? me.money >= spec.cost : false;
    const selected = mode.kind === "build" && mode.building === type;
    const card = el("button", {
      class: `build-card${selected ? " selected" : ""}${affordable ? "" : " disabled"}`,
      type: "button",
    });
    card.append(
      el("span", { class: "build-icon", text: spec.icon }),
      el("span", { class: "build-main" }, [
        el("span", { class: "build-name", text: `${spec.label} · ${formatMoney(spec.cost)} $` }),
        el("span", { class: "build-desc", text: spec.description }),
        el("span", {
          class: "build-meta",
          text: `${counts[type] ?? 0} construit(s) · ${(spec.buildTicks / 10).toFixed(0)} s · entretien ${(spec.upkeep * 10).toFixed(1)} $/s`,
        }),
      ]),
    );
    card.addEventListener("click", () => {
      if (!affordable) return;
      actions.setMode(selected ? { kind: "none" } : { kind: "build", building: type });
    });
    cards.push(card);
  }

  const hint = el("div", { class: "sheet-hint" });
  if (mode.kind === "build") {
    hint.textContent = `Placement : ${BUILDINGS[mode.building].label}. Clique sur une de tes cases, ou Échap pour annuler.`;
  } else {
    hint.textContent =
      "Choisis un bâtiment puis clique sur la carte. Les usines et aéroports doivent être reliés par des routes à une ville, un port ou une usine.";
  }

  return {
    title: "🏗️ Construire",
    children: [
      section("Bâtiments", cards),
      el("div", { class: "sheet-actions" }, [
        button("🛣️ Mode route", () => {
          actions.setMode({ kind: "build", building: "road" });
        }, { class: "btn ghost" }),
        button("Annuler la sélection", () => actions.setMode({ kind: "none" }), {
          class: "btn ghost",
        }),
      ]),
      hint,
    ],
  };
}

function countBuildings(store: Store): Partial<Record<BuildingType, number>> {
  const counts: Partial<Record<BuildingType, number>> = {};
  const me = store.playerId;
  for (const building of store.buildings.values()) {
    if (building.ownerId !== me) continue;
    counts[building.type] = (counts[building.type] ?? 0) + 1;
  }
  return counts;
}

function politicsPanel(store: Store, actions: UiActions): PanelContent {
  const me = store.me();
  if (!me) return { title: "🏛️ Politique", children: [el("div", { class: "sheet-hint", text: "Choisis une nation pour accéder à la politique." })] };
  const current = GOVERNMENTS[me.country.government];
  const cards: HTMLElement[] = [];
  for (const type of GOVERNMENT_TYPES) {
    const spec = GOVERNMENTS[type];
    const selected = me.country.government === type;
    const card = el("button", {
      class: `government-card${selected ? " selected" : ""}`,
      type: "button",
    });
    card.append(
      el("span", { class: "government-icon", text: spec.icon }),
      el("span", { class: "government-main" }, [
        el("span", { class: "government-name", text: spec.label }),
        el("span", { class: "government-desc", text: spec.description }),
        el("span", { class: "government-meta", text: modifiersText(type) }),
      ]),
    );
    card.addEventListener("click", () => {
      if (selected) return;
      if (me.governmentCooldown > 0) {
        actions.notify(
          `Changement de régime disponible dans ${Math.ceil(me.governmentCooldown / 10)} s.`,
        );
        return;
      }
      actions.setGovernment(type);
    });
    cards.push(card);
  }

  const taxWrapper = el("div", { class: "slider-row" });
  const taxValue = el("span", { class: "slider-value", text: `${me.taxRate} %` });
  const slider = el("input", {
    type: "range",
    min: 10,
    max: 90,
    step: 5,
    value: me.taxRate,
    class: "slider",
  });
  slider.addEventListener("input", () => {
    taxValue.textContent = `${slider.value} %`;
  });
  slider.addEventListener("change", () => {
    actions.setTax(Number(slider.value));
  });
  taxWrapper.append(el("span", { class: "slider-label", text: "Fiscalité" }), slider, taxValue);

  const happiness = bar(me.country.happiness, 100, "happiness");
  const discontent = bar(me.country.discontent, 100, "discontent");
  const risk = me.country.discontent >= 75;

  return {
    title: `🏛️ Politique · ${current.icon} ${current.label}`,
    children: [
      section("Climat social", [
        el("div", { class: "sheet-row" }, [el("span", { text: `Bonheur ${Math.round(me.country.happiness)} %` }), happiness]),
        el("div", { class: "sheet-row" }, [el("span", { text: `Mécontentement ${Math.round(me.country.discontent)} %` }), discontent]),
        el("div", {
          class: `sheet-hint${risk ? " danger" : ""}`,
          text: risk
            ? "⚠️ Le mécontentement approche du seuil de sécession. Baisse les impôts, construis des forts ou change de régime."
            : "Le mécontentement monte avec les impôts, les guerres et les pertes militaires. À 100 %, une partie du pays peut faire sécession.",
        }),
      ]),
      section("Fiscalité", [taxWrapper]),
      section("Régimes", cards),
      section("Effets actuels", [
        el("div", { class: "sheet-hint", text: productionSummary(me.cities, me.taxRate) }),
      ]),
    ],
  };
}

function modifiersText(type: GovernmentType): string {
  const modifiers = GOVERNMENTS[type].modifiers;
  const percent = (value: number): string => `${value >= 1 ? "+" : ""}${Math.round((value - 1) * 100)} %`;
  return `Production ${percent(modifiers.productionMultiplier)} · Économie ${percent(modifiers.economicMultiplier)} · Population ${percent(modifiers.populationGrowthMultiplier)} · Stabilité ${percent(modifiers.stability)} · Impôt de base ${modifiers.taxRate} %`;
}

function productionSummary(cities: number, taxRate: number): string {
  return `${cities} ville(s) : +${cities * 2} % de production industrielle. Fiscalité effective : ${taxRate} %.`;
}

function diplomacyPanel(store: Store, actions: UiActions): PanelContent {
  const me = store.me();
  if (!me) return { title: "🤝 Diplomatie", children: [el("div", { class: "sheet-hint", text: "Choisis une nation pour la diplomatie." })] };
  const alliance = store.allianceOf(me.id);
  const children: HTMLElement[] = [];

  if (me.pendingAllianceFrom.length > 0) {
    const requests = me.pendingAllianceFrom.map((from) => {
      const suitor = store.player(from);
      if (!suitor) return el("div");
      return el("div", { class: "diplo-request" }, [
        el("span", { text: `${suitor.country.flag} ${suitor.country.name} propose une alliance` }),
        el("div", { class: "sheet-actions" }, [
          button("Accepter", () => actions.respondAlliance(from, true), { class: "btn primary" }),
          button("Refuser", () => actions.respondAlliance(from, false), { class: "btn ghost" }),
        ]),
      ]);
    });
    children.push(section("Demandes reçues", requests));
  }

  if (alliance) {
    const allies = alliance.members
      .filter((id) => id !== me.id)
      .map((id) => store.player(id))
      .filter((player): player is NonNullable<typeof player> => Boolean(player));
    const moneySlider = el("input", {
      type: "range",
      min: 0,
      max: 50,
      step: 5,
      value: me.transferSettings.moneyPercentage,
      class: "slider",
    });
    const troopSlider = el("input", {
      type: "range",
      min: 0,
      max: 50,
      step: 5,
      value: me.transferSettings.troopPercentage,
      class: "slider",
    });
    const moneyValue = el("span", { class: "slider-value", text: `${me.transferSettings.moneyPercentage} %` });
    const troopValue = el("span", { class: "slider-value", text: `${me.transferSettings.troopPercentage} %` });
    moneySlider.addEventListener("input", () => {
      moneyValue.textContent = `${moneySlider.value} %`;
    });
    troopSlider.addEventListener("input", () => {
      troopValue.textContent = `${troopSlider.value} %`;
    });
    const apply = button("Appliquer les transferts", () => {
      actions.setTransferSettings(Number(moneySlider.value), Number(troopSlider.value));
    }, { class: "btn primary" });
    children.push(
      section(
        "Alliance active",
        [
          el("div", { class: "sheet-hint", text: `Alliés : ${allies.map((ally) => `${ally.country.flag} ${ally.country.name}`).join(", ") || "—"}` }),
          el("div", { class: "slider-row" }, [el("span", { class: "slider-label", text: "Argent" }), moneySlider, moneyValue]),
          el("div", { class: "slider-row" }, [el("span", { class: "slider-label", text: "Troupes" }), troopSlider, troopValue]),
          el("div", { class: "sheet-actions" }, [apply, button("Rompre l'alliance", () => actions.breakAlliance(), { class: "btn danger" })]),
          el("div", { class: "sheet-hint", text: "Les pourcentages transfèrent automatiquement une part de tes revenus et de ton recrutement à ton allié." }),
        ],
      ),
    );
  }

  const rows: HTMLElement[] = [];
  const others = [...store.players.values()]
    .filter((player) => player.alive && player.id !== me.id)
    .sort((a, b) => b.tiles - a.tiles);
  for (const other of others) {
    const relation = store.relationWith(other.id);
    const row = el("div", { class: "diplo-row" }, [
      el("div", { class: "diplo-name" }, [
        el("span", { text: `${other.country.flag} ${other.country.name}${other.isBot ? " 🤖" : ""}` }),
        el("span", {
          class: "diplo-sub",
          text: `${formatNumber(other.tiles)} cases · ${relation === "ally" ? "allié" : relation === "war" || relation === "civil_war" ? "en guerre" : "neutre"}`,
        }),
      ]),
    ]);
    const controls = el("div", { class: "diplo-actions" });
    if (relation === "ally") {
      controls.append(
        button("+250 $", () => actions.gift(other.id, "money", 250), { class: "btn small" }),
        button("+100 🎖️", () => actions.gift(other.id, "troops", 100), { class: "btn small" }),
      );
    } else if (relation === "neutral") {
      controls.append(
        button("Proposer", () => actions.requestAlliance(other.id), { class: "btn small primary" }),
      );
    } else {
      controls.append(el("span", { class: "diplo-war", text: "⚔️" }));
    }
    row.append(controls);
    rows.push(row);
  }
  children.push(section("Nations", rows));
  return { title: "🤝 Diplomatie", children };
}

function militaryPanel(store: Store, actions: UiActions): PanelContent {
  const me = store.me();
  const mode = actions.getMode();
  if (!me) return { title: "🚀 Armement", children: [el("div", { class: "sheet-hint", text: "Choisis une nation." })] };
  const cards: HTMLElement[] = [];
  for (const kind of Object.keys(STRATEGIC_WEAPONS) as StrategicKind[]) {
    const spec = STRATEGIC_WEAPONS[kind];
    const cooldown = me.cooldowns[kind];
    const unlocked = me.unlocks.strategic && (me.silos > 0);
    const selected = mode.kind === "missile" && mode.weapon === kind;
    const card = el("button", {
      class: `build-card${selected ? " selected" : ""}${unlocked && cooldown === 0 && me.money >= spec.cost ? "" : " disabled"}`,
      type: "button",
    });
    card.append(
      el("span", { class: "build-icon", text: spec.icon }),
      el("span", { class: "build-main" }, [
        el("span", { class: "build-name", text: `${spec.label} · ${formatMoney(spec.cost)} $` }),
        el("span", { class: "build-desc", text: spec.description }),
        el("span", {
          class: "build-meta",
          text: cooldown > 0
            ? `Rechargement : ${Math.ceil(cooldown / 10)} s`
            : `Rayon ${spec.radius} cases · ${spec.warheads} tête(s) · interception ${Math.round(spec.baseInterception * 100)} %`,
        }),
      ]),
    );
    card.addEventListener("click", () => {
      if (!unlocked) {
        actions.notify("Construis d'abord un lance-missiles.");
        return;
      }
      if (cooldown > 0) return;
      if (me.money < spec.cost) {
        actions.notify("Pas assez d'argent.");
        return;
      }
      actions.setMode(selected ? { kind: "none" } : { kind: "missile", weapon: kind });
    });
    cards.push(card);
  }

  const navy: HTMLElement[] = [];
  navy.push(
    el("div", { class: "sheet-hint", text: me.unlocks.naval ? "Clique sur « Débarquement », puis sur une côte ennemie ou libre." : "Construis un port pour débloquer la marine." }),
  );
  navy.push(
    el("div", { class: "sheet-actions" }, [
      button("⛵ Débarquement (150 troupes)", () => {
        if (!me.unlocks.naval) {
          actions.notify("Il faut un port.");
          return;
        }
        actions.setMode(mode.kind === "boat" && mode.boat === "transport" ? { kind: "none" } : { kind: "boat", boat: "transport" });
      }, { class: `btn${mode.kind === "boat" && mode.boat === "transport" ? " primary" : ""}`, disabled: !me.unlocks.naval }),
      button("🚢 Bateau de guerre", () => {
        if (!me.unlocks.naval) return;
        actions.setMode(mode.kind === "boat" && mode.boat === "warship" ? { kind: "none" } : { kind: "boat", boat: "warship" });
      }, { class: `btn${mode.kind === "boat" && mode.boat === "warship" ? " primary" : ""}`, disabled: !me.unlocks.naval }),
    ]),
  );
  navy.push(
    el("div", { class: "sheet-hint", text: `Défense antimissile : ${me.sams} batterie(s) SAM. Chaque batterie intercepte automatiquement les frappes dans son rayon.` }),
  );

  return {
    title: "🚀 Armement stratégique",
    children: [
      section("Frappes", cards),
      el("div", { class: "sheet-hint", text: `Lance-missiles : ${me.silos}. Les missiles peuvent être interceptés par les SAM adverses.` }),
      section("Marine", navy),
      el("div", { class: "sheet-actions" }, [
        button("Annuler la sélection", () => actions.setMode({ kind: "none" }), { class: "btn ghost" }),
      ]),
    ],
  };
}

function helpPanel(_force: boolean): PanelContent {
  return {
    title: "❔ Aide",
    children: [
      section("Contrôles", [
        el("ul", { class: "help-list" }, [
          el("li", { text: "Clic gauche : attaquer / coloniser vers le curseur (ou placer le bâtiment sélectionné)." }),
          el("li", { text: "Clic droit : menu contextuel (attaque, diplomatie, marine, missiles, construction)." }),
          el("li", { text: "Molette : zoom. Glisser avec le bouton droit ou du doigt : déplacer la carte." }),
          el("li", { text: "Échap : annuler la sélection en cours." }),
        ]),
      ]),
      section("Règles essentielles", [
        el("ul", { class: "help-list" }, [
          el("li", { text: "La conquête est locale : on ne prend que des cases adjacentes à son territoire." }),
          el("li", { text: "Les villes augmentent la population maximale et donnent +2 % de production chacune." }),
          el("li", { text: "Les usines ne produisent que si elles sont reliées par des routes à une ville, un port ou une autre usine." }),
          el("li", { text: "Les ports créent des routes commerciales, les aéroports des liaisons aériennes." }),
          el("li", { text: "Le mécontentement monte avec les impôts et les guerres : à 100 %, une sécession peut éclater." }),
          el("li", { text: "Les forts ralentissent la conquête et protègent de la sécession." }),
          el("li", { text: "Les missiles exigent un lance-missiles et peuvent être interceptés par les SAM." }),
        ]),
      ]),
    ],
  };
}
