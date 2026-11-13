/** Alliances, diplomatic relations and resource transfers. */

export type RelationKind = "neutral" | "ally" | "war" | "civil_war";

export interface TransferSettings {
  /** Percentage of the money income automatically sent to allies (0..50). */
  moneyPercentage: number;
  /** Percentage of the troops produced automatically sent to allies (0..50). */
  troopPercentage: number;
  /** Allow alliance-wide automatic transfers. */
  allowAutoTransfers: boolean;
}

export interface AllianceData {
  id: number;
  /** Player ids, sorted ascending for stable serialisation. */
  members: number[];
  troopTransferPercentage: number;
  moneyTransferPercentage: number;
  active: boolean;
  createdAtTick: number;
}

export interface AllianceRequest {
  fromId: number;
  toId: number;
  createdAtTick: number;
}

export type GiftKind = "troops" | "money";

export interface DiplomacyRelation {
  a: number;
  b: number;
  kind: RelationKind;
  /** Alliance id when kind === "ally". */
  allianceId?: number;
}

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  moneyPercentage: 0,
  troopPercentage: 0,
  allowAutoTransfers: false,
};
