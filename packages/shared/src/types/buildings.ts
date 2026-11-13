/** Buildings, their specs and their runtime state. */

export type BuildingType =
  | "city"
  | "factory"
  | "port"
  | "fort"
  | "missile_silo"
  | "sam_launcher"
  | "airport"
  | "road";

export const BUILDING_TYPES: readonly BuildingType[] = [
  "city",
  "factory",
  "port",
  "fort",
  "missile_silo",
  "sam_launcher",
  "airport",
  "road",
];

export interface BuildingSpec {
  type: BuildingType;
  label: string;
  icon: string;
  description: string;
  cost: number;
  /** Construction time in server ticks. */
  buildTicks: number;
  /** Money per tick. */
  upkeep: number;
  maxLevel: number;
  /** Money cost of the first upgrade. */
  upgradeCost: number;
  /** Must be adjacent to water (ocean or lake). */
  requiresCoast: boolean;
  /** Bonus value per level, meaning depends on the building. */
  effectPerLevel: number;
  /** True when the building must be attached to a transport network. */
  requiresNetwork: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  city: {
    type: "city",
    label: "Ville",
    icon: "🏙️",
    description:
      "Augmente la population maximale et donne +2 % de production par ville (cumulable).",
    cost: 520,
    buildTicks: 60,
    upkeep: 0.15,
    maxLevel: 5,
    upgradeCost: 700,
    requiresCoast: false,
    effectPerLevel: 45,
    requiresNetwork: false,
  },
  factory: {
    type: "factory",
    label: "Usine",
    icon: "🏭",
    description:
      "Génère de l'argent, uniquement si elle est reliée à un réseau (ville, port ou autre usine).",
    cost: 780,
    buildTicks: 90,
    upkeep: 0.35,
    maxLevel: 5,
    upgradeCost: 950,
    requiresCoast: false,
    effectPerLevel: 1.1,
    requiresNetwork: true,
  },
  port: {
    type: "port",
    label: "Port",
    icon: "⚓",
    description:
      "Génère du commerce maritime, envoie des bateaux marchands et débloque la septième capacité.",
    cost: 900,
    buildTicks: 100,
    upkeep: 0.3,
    maxLevel: 4,
    upgradeCost: 1100,
    requiresCoast: true,
    effectPerLevel: 0.9,
    requiresNetwork: false,
  },
  fort: {
    type: "fort",
    label: "Fort",
    icon: "🛡️",
    description:
      "Renforce la défense locale, ralentit la conquête et réduit le risque de sécession.",
    cost: 620,
    buildTicks: 80,
    upkeep: 0.2,
    maxLevel: 4,
    upgradeCost: 800,
    requiresCoast: false,
    effectPerLevel: 0.35,
    requiresNetwork: false,
  },
  missile_silo: {
    type: "missile_silo",
    label: "Lance-missiles",
    icon: "🚀",
    description: "Débloque les frappes stratégiques (missile, MIRV, bombe H).",
    cost: 1600,
    buildTicks: 140,
    upkeep: 0.6,
    maxLevel: 3,
    upgradeCost: 1900,
    requiresCoast: false,
    effectPerLevel: 0.15,
    requiresNetwork: false,
  },
  sam_launcher: {
    type: "sam_launcher",
    label: "Batterie SAM",
    icon: "📡",
    description:
      "Intercepte automatiquement les missiles qui entrent dans sa zone de défense.",
    cost: 1100,
    buildTicks: 110,
    upkeep: 0.4,
    maxLevel: 4,
    upgradeCost: 1300,
    requiresCoast: false,
    effectPerLevel: 0.12,
    requiresNetwork: false,
  },
  airport: {
    type: "airport",
    label: "Aéroport",
    icon: "✈️",
    description:
      "Lance des avions commerciaux vers les autres aéroports et des avions de chasse pour la défense aérienne.",
    cost: 1250,
    buildTicks: 120,
    upkeep: 0.5,
    maxLevel: 4,
    upgradeCost: 1500,
    requiresCoast: false,
    effectPerLevel: 0.9,
    requiresNetwork: true,
  },
  road: {
    type: "road",
    label: "Route",
    icon: "🛣️",
    description:
      "Relie les bâtiments entre eux. Une usine non reliée ne produit pas.",
    cost: 30,
    buildTicks: 6,
    upkeep: 0.01,
    maxLevel: 1,
    upgradeCost: 0,
    requiresCoast: false,
    effectPerLevel: 0,
    requiresNetwork: false,
  },
};

/** Runtime building instance. */
export interface BuildingData {
  id: number;
  ownerId: number;
  type: BuildingType;
  level: number;
  /** Tile index on the map grid. */
  tile: number;
  /** Ticks remaining before the building is operational. */
  buildRemaining: number;
  /** Current hit points. */
  hp: number;
  maxHp: number;
  /** True when the building is attached to a connected transport network. */
  connected: boolean;
}

export type NetworkKind = "road" | "sea" | "air";

export interface TradeNetwork {
  id: number;
  ownerId: number;
  kind: NetworkKind;
  /** Building ids of the network. */
  buildingIds: number[];
  /** Money generated per tick by the network. */
  revenuePerTick: number;
}
