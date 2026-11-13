/** Nation selection screen (spawn identity: name, flag, colour, government). */

import {
  COUNTRY_PRESETS,
  GOVERNMENTS,
  GOVERNMENT_TYPES,
  type GovernmentType,
} from "@openwars/shared";
import { button, el, setText } from "../dom";
import type { Store } from "../state";

export interface JoinPayload {
  name: string;
  countryName: string;
  flag: string;
  color: string;
  government: GovernmentType;
}

export class NationMenu {
  readonly root = el("div", { class: "menu" });
  private nameInput!: HTMLInputElement;
  private countryInput!: HTMLInputElement;
  private colorInput!: HTMLInputElement;
  private flag = COUNTRY_PRESETS[0]!.flag;
  private color = COUNTRY_PRESETS[0]!.color;
  private government: GovernmentType = "republic";
  private flagGrid = el("div", { class: "flag-grid" });
  private governmentList = el("div", { class: "menu-governments" });
  private status = el("div", { class: "menu-status" });
  private worldInfo = el("div", { class: "menu-world" });
  private joinButton = button("Rejoindre la partie", () => this.submit(), {
    class: "btn primary large",
  });

  constructor(
    private readonly store: Store,
    private readonly onJoin: (payload: JoinPayload) => void,
    private readonly onSpectate: () => void,
  ) {
    this.build();
  }

  private build(): void {
    const preset = COUNTRY_PRESETS[0]!;
    this.nameInput = el("input", {
      class: "menu-input",
      type: "text",
      maxlength: 18,
      placeholder: "Ton pseudo",
      value: "Dirigeant",
    }) as HTMLInputElement;
    this.countryInput = el("input", {
      class: "menu-input",
      type: "text",
      maxlength: 20,
      placeholder: "Nom du pays",
      value: preset.name,
    }) as HTMLInputElement;
    this.colorInput = el("input", {
      class: "menu-color",
      type: "color",
      value: this.color,
    }) as HTMLInputElement;
    this.colorInput.addEventListener("input", () => {
      this.color = this.colorInput.value;
    });

    this.countryInput.addEventListener("input", () => {
      const match = COUNTRY_PRESETS.find((candidate) => candidate.name === this.countryInput.value);
      if (!match) return;
      this.flag = match.flag;
      this.color = match.color;
      this.colorInput.value = match.color;
      this.renderFlags();
    });

    for (const candidate of COUNTRY_PRESETS) {
      const item = button(candidate.flag, () => {
        this.flag = candidate.flag;
        this.color = candidate.color;
        this.colorInput.value = candidate.color;
        if (!this.countryInput.value.trim()) this.countryInput.value = candidate.name;
        this.renderFlags();
      }, { class: "flag-button", title: candidate.name });
      item.dataset["flag"] = candidate.flag;
      this.flagGrid.append(item);
    }

    for (const type of GOVERNMENT_TYPES) {
      const spec = GOVERNMENTS[type];
      const modifiers = spec.modifiers;
      const card = button("", () => {
        this.government = type;
        this.renderGovernments();
      }, { class: "menu-government" });
      card.replaceChildren(
        el("span", { class: "menu-government-icon", text: spec.icon }),
        el("span", { class: "menu-government-main" }, [
          el("span", { class: "menu-government-name", text: spec.label }),
          el("span", {
            class: "menu-government-meta",
            text: `Prod ${Math.round((modifiers.productionMultiplier - 1) * 100)} % · Éco ${Math.round((modifiers.economicMultiplier - 1) * 100)} % · Pop ${Math.round((modifiers.populationGrowthMultiplier - 1) * 100)} %`,
          }),
        ]),
      );
      card.dataset["type"] = type;
      this.governmentList.append(card);
    }

    const identity = el("div", { class: "menu-card" }, [
      el("div", { class: "menu-card-title", text: "Ton pays" }),
      el("label", { class: "menu-label", text: "Pseudo" }),
      this.nameInput,
      el("label", { class: "menu-label", text: "Nom du pays" }),
      this.countryInput,
      el("div", { class: "menu-row" }, [
        el("div", {}, [
          el("label", { class: "menu-label", text: "Drapeau" }),
          this.flagGrid,
        ]),
        el("div", {}, [
          el("label", { class: "menu-label", text: "Couleur" }),
          this.colorInput,
        ]),
      ]),
      el("label", { class: "menu-label", text: "Régime politique" }),
      this.governmentList,
    ]);

    const side = el("div", { class: "menu-card side" }, [
      el("div", { class: "menu-card-title", text: "Monde actuel" }),
      this.worldInfo,
      el("div", { class: "menu-help" }, [
        el("div", { text: "Objectif : conquérir, développer ton économie et tenir ta population." }),
        el("div", { text: "Clic gauche pour attaquer, clic droit pour le menu contextuel." }),
        el("div", { text: "Les nations IA remplissent le monde ; tu peux aussi reprendre une nation existante." }),
      ]),
      this.status,
      el("div", { class: "menu-actions" }, [
        this.joinButton,
        button("Observer", () => this.onSpectate(), { class: "btn ghost" }),
      ]),
    ]);

    this.root.append(
      el("div", { class: "menu-header" }, [
        el("h1", { text: "OpenWars" }),
        el("p", { text: "Grande stratégie multijoueur · territoire, politique, économie, diplomatie" }),
      ]),
      el("div", { class: "menu-grid" }, [identity, side]),
    );
    this.renderFlags();
    this.renderGovernments();
  }

  private renderFlags(): void {
    for (const child of Array.from(this.flagGrid.children)) {
      const element = child as HTMLElement;
      element.classList.toggle("selected", element.dataset["flag"] === this.flag);
    }
  }

  private renderGovernments(): void {
    for (const child of Array.from(this.governmentList.children)) {
      const element = child as HTMLElement;
      element.classList.toggle("selected", element.dataset["type"] === this.government);
    }
  }

  private submit(): void {
    const name = this.nameInput.value.trim() || "Dirigeant";
    const countryName = this.countryInput.value.trim() || "Nouvelle nation";
    this.onJoin({
      name,
      countryName,
      flag: this.flag,
      color: this.color,
      government: this.government,
    });
  }

  show(): void {
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  setStatus(text: string, tone: "info" | "error" = "info"): void {
    setText(this.status, text);
    this.status.classList.toggle("error", tone === "error");
  }

  setConnected(connected: boolean): void {
    this.joinButton.disabled = !connected;
    if (!connected) {
      setText(this.status, "Connexion au serveur…");
      this.status.classList.remove("error");
    } else if (this.status.textContent === "Connexion au serveur…") {
      setText(this.status, "");
    }
  }

  update(): void {
    const players = [...this.store.players.values()].filter((player) => player.alive);
    const humans = players.filter((player) => !player.isBot).length;
    const top = players
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((player) => `${player.country.flag} ${player.country.name} · ${player.tiles} cases`)
      .join("\n");
    setText(
      this.worldInfo,
      `${players.length} nations (${humans} humain${humans > 1 ? "s" : ""})\n${top || "Aucune nation pour l'instant"}`,
    );
  }
}
