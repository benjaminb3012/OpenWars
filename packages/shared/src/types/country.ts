/**
 * Shared country / government types.
 * Used by both the deterministic engine and the browser client.
 */

export type GovernmentType =
  | "democracy"
  | "dictatorship"
  | "monarchy"
  | "republic"
  | "communism"
  | "military";

export const GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "democracy",
  "dictatorship",
  "monarchy",
  "republic",
  "communism",
  "military",
];

/** A country is the playable identity of a player. */
export interface CountryData {
  /** Country name shown on the map, in the scoreboard and in diplomacy. */
  name: string;
  /** Flag, stored as an emoji so no binary asset is needed. */
  flag: string;
  /** HSL-friendly hex colour used to paint the territory. */
  color: string;
  government: GovernmentType;
  /** 0..100 happiness of the population. */
  happiness: number;
  /** 0..100 discontent. At 100 a civil war becomes possible. */
  discontent: number;
}

/**
 * Multipliers applied by a government.
 * Every value is a multiplier around 1 except `taxRate`, which is a percentage.
 */
export interface PoliticalModifiers {
  /** Building speed / factory efficiency / territorial development. */
  productionMultiplier: number;
  /** Money generation, resource output, infrastructure revenue. */
  economicMultiplier: number;
  /** Tax pressure, folded into money generation but also into discontent. */
  taxRate: number;
  /** Population growth and max population capacity. */
  populationGrowthMultiplier: number;
  /** Baseline happiness contribution of the regime. */
  happinessBias: number;
  /** How fast discontent accumulates. */
  discontentMultiplier: number;
  /** Resistance against civil war secession (forts add on top). */
  stability: number;
}

export interface GovernmentSpec {
  type: GovernmentType;
  label: string;
  description: string;
  icon: string;
  modifiers: PoliticalModifiers;
}

export const GOVERNMENTS: Record<GovernmentType, GovernmentSpec> = {
  democracy: {
    type: "democracy",
    label: "Démocratie",
    description:
      "Croissance et bonheur élevés, armée plus lente à mobiliser. Peu de mécontentement.",
    icon: "🗳️",
    modifiers: {
      productionMultiplier: 1.05,
      economicMultiplier: 1.1,
      taxRate: 25,
      populationGrowthMultiplier: 1.25,
      happinessBias: 12,
      discontentMultiplier: 0.75,
      stability: 1.15,
    },
  },
  dictatorship: {
    type: "dictatorship",
    label: "Dictature",
    description:
      "Mobilisation militaire et production rapides, population mécontente et instable.",
    icon: "👊",
    modifiers: {
      productionMultiplier: 1.25,
      economicMultiplier: 1.0,
      taxRate: 45,
      populationGrowthMultiplier: 0.8,
      happinessBias: -18,
      discontentMultiplier: 1.4,
      stability: 0.85,
    },
  },
  monarchy: {
    type: "monarchy",
    label: "Monarchie",
    description: "Régime stable et légitime, économie moyenne, défense solide.",
    icon: "👑",
    modifiers: {
      productionMultiplier: 1.05,
      economicMultiplier: 1.05,
      taxRate: 30,
      populationGrowthMultiplier: 1.0,
      happinessBias: 6,
      discontentMultiplier: 0.9,
      stability: 1.3,
    },
  },
  republic: {
    type: "republic",
    label: "République",
    description: "Économie prospère et fiscalité modérée, armée standard.",
    icon: "🏛️",
    modifiers: {
      productionMultiplier: 1.1,
      economicMultiplier: 1.2,
      taxRate: 28,
      populationGrowthMultiplier: 1.1,
      happinessBias: 8,
      discontentMultiplier: 0.85,
      stability: 1.1,
    },
  },
  communism: {
    type: "communism",
    label: "Régime communiste",
    description:
      "Production industrielle massive et population nombreuse, revenus faibles.",
    icon: "⚒️",
    modifiers: {
      productionMultiplier: 1.35,
      economicMultiplier: 0.8,
      taxRate: 50,
      populationGrowthMultiplier: 1.3,
      happinessBias: -8,
      discontentMultiplier: 1.15,
      stability: 1.0,
    },
  },
  military: {
    type: "military",
    label: "Régime militaire",
    description:
      "Armée et conquête très efficaces, économie et bonheur sacrifiés.",
    icon: "⭐",
    modifiers: {
      productionMultiplier: 1.2,
      economicMultiplier: 0.85,
      taxRate: 55,
      populationGrowthMultiplier: 0.85,
      happinessBias: -22,
      discontentMultiplier: 1.25,
      stability: 0.95,
    },
  },
};

/** Countries selectable at spawn time (flag + default colour). */
export interface CountryPreset {
  name: string;
  flag: string;
  color: string;
}

export const COUNTRY_PRESETS: readonly CountryPreset[] = [
  { name: "France", flag: "🇫🇷", color: "#3b6bd6" },
  { name: "Allemagne", flag: "🇩🇪", color: "#2b2b2b" },
  { name: "Italie", flag: "🇮🇹", color: "#2ea36b" },
  { name: "Espagne", flag: "🇪🇸", color: "#d9a12b" },
  { name: "Royaume-Uni", flag: "🇬🇧", color: "#7b3fbd" },
  { name: "Pologne", flag: "🇵🇱", color: "#c8455c" },
  { name: "Suède", flag: "🇸🇪", color: "#2a8fb8" },
  { name: "Grèce", flag: "🇬🇷", color: "#4b9fd1" },
  { name: "Turquie", flag: "🇹🇷", color: "#c0392b" },
  { name: "Maroc", flag: "🇲🇦", color: "#b3462f" },
  { name: "Égypte", flag: "🇪🇬", color: "#c9a227" },
  { name: "Nigeria", flag: "🇳🇬", color: "#2f8f5b" },
  { name: "Brésil", flag: "🇧🇷", color: "#3f8f3f" },
  { name: "Argentine", flag: "🇦🇷", color: "#57a7d1" },
  { name: "Canada", flag: "🇨🇦", color: "#b8452f" },
  { name: "Mexique", flag: "🇲🇽", color: "#2f7d4f" },
  { name: "Japon", flag: "🇯🇵", color: "#c0392b" },
  { name: "Corée", flag: "🇰🇷", color: "#3f5fbd" },
  { name: "Inde", flag: "🇮🇳", color: "#c47f2b" },
  { name: "Australie", flag: "🇦🇺", color: "#2f7d8f" },
  { name: "Indonésie", flag: "🇮🇩", color: "#a83f3f" },
  { name: "Afrique du Sud", flag: "🇿🇦", color: "#2f8f6b" },
  { name: "États-Unis", flag: "🇺🇸", color: "#3f5fa8" },
  { name: "Ukraine", flag: "🇺🇦", color: "#5b8fd1" },
];
