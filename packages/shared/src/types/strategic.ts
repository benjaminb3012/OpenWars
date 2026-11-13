/**
 * Strategic weapons: abstract game mechanics, deliberately not modelled on
 * real weapon systems. Every value is a balance knob.
 */

export type StrategicKind = "missile" | "mirv" | "hydrogen";

export interface StrategicSpec {
  kind: StrategicKind;
  label: string;
  icon: string;
  description: string;
  cost: number;
  /** Cooldown in ticks before the same player can fire again. */
  cooldownTicks: number;
  /** Blast radius in tiles. */
  radius: number;
  /** Troop damage applied to every player inside the radius. */
  troopDamage: number;
  /** Population killed inside the radius. */
  populationDamage: number;
  /** Building hit points removed inside the radius. */
  buildingDamage: number;
  /** Base interception chance of a defending SAM site (0..1). */
  baseInterception: number;
  /** Number of independent warheads (MIRV). */
  warheads: number;
  /** Travel time in ticks. */
  flightTicks: number;
  /** Minimum silo level required. */
  requiredSiloLevel: number;
}

export const STRATEGIC_WEAPONS: Record<StrategicKind, StrategicSpec> = {
  missile: {
    kind: "missile",
    label: "Missile",
    icon: "🚀",
    description:
      "Frappe unique et rapide. Détruit les bâtiments dans un rayon modéré.",
    cost: 900,
    cooldownTicks: 220,
    radius: 5,
    troopDamage: 180,
    populationDamage: 1100,
    buildingDamage: 90,
    baseInterception: 0.55,
    warheads: 1,
    flightTicks: 26,
    requiredSiloLevel: 1,
  },
  mirv: {
    kind: "mirv",
    label: "MIRV",
    icon: "🎯",
    description:
      "Trois têtes dispersées autour de la cible : couvre une zone plus large.",
    cost: 1500,
    cooldownTicks: 320,
    radius: 4,
    troopDamage: 130,
    populationDamage: 800,
    buildingDamage: 70,
    baseInterception: 0.45,
    warheads: 3,
    flightTicks: 30,
    requiredSiloLevel: 2,
  },
  hydrogen: {
    kind: "hydrogen",
    label: "Bombe à hydrogène",
    icon: "☢️",
    description:
      "Frappe dévastatrice : rayon immense, infrastructures rasées, défense saturée.",
    cost: 3200,
    cooldownTicks: 600,
    radius: 11,
    troopDamage: 700,
    populationDamage: 6500,
    buildingDamage: 240,
    baseInterception: 0.3,
    warheads: 1,
    flightTicks: 40,
    requiredSiloLevel: 1,
  },
};
