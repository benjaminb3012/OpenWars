/**
 * Transport networks.
 *
 * Roads are tiles owned by a player. A building is "attached" when one of its
 * 4-neighbours is a road of the same owner; buildings attached to the same
 * connected road component form a network. A factory only produces at full
 * capacity when its network also contains another hub (city, port, factory or
 * airport), which implements "a factory must be connected".
 *
 * The computation is a pair of BFS passes and only runs when the roads or the
 * buildings changed (see GameImpl), never on every tick.
 */

import type { BuildingType } from "@openwars/shared";

export interface NetworkBuildingRef {
  id: number;
  type: BuildingType;
  tile: number;
  ownerId: number;
}

const HUB_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  "city",
  "factory",
  "port",
  "airport",
]);

export interface TransportNetworkResult {
  /** Building ids attached to a network that is valid for their type. */
  connected: Set<number>;
  /** Component id per road tile (-1 when the tile is not a road). */
  componentOf: Int32Array;
  /** Number of networks per player. */
  networkCount: Map<number, number>;
  /** Building ids grouped per network component. */
  members: Map<number, number[]>;
}

export function computeTransportNetworks(params: {
  width: number;
  height: number;
  /** Road ownership per tile (0 = no road). */
  road: Uint16Array;
  buildings: readonly NetworkBuildingRef[];
}): TransportNetworkResult {
  const { width, height, road, buildings } = params;
  const tileCount = width * height;
  const componentOf = new Int32Array(tileCount).fill(-1);
  const members = new Map<number, number[]>();
  let nextComponent = 0;

  const queue: number[] = [];
  for (let start = 0; start < tileCount; start++) {
    if (road[start] === 0 || componentOf[start] !== -1) continue;
    const ownerId = road[start]!;
    const componentId = nextComponent++;
    componentOf[start] = componentId;
    queue.length = 0;
    queue.push(start);
    for (let head = 0; head < queue.length; head++) {
      const tile = queue[head]!;
      const x = tile % width;
      const y = (tile - x) / width;
      const push = (neighbor: number): void => {
        if (componentOf[neighbor] !== -1) return;
        if (road[neighbor] !== ownerId) return;
        componentOf[neighbor] = componentId;
        queue.push(neighbor);
      };
      if (x + 1 < width) push(tile + 1);
      if (x - 1 >= 0) push(tile - 1);
      if (y + 1 < height) push(tile + width);
      if (y - 1 >= 0) push(tile - width);
    }
    members.set(componentId, []);
  }

  const buildingComponent = new Map<number, number>();
  for (const building of buildings) {
    if (building.type === "road") continue;
    const tile = building.tile;
    const x = tile % width;
    const y = (tile - x) / width;
    let component = -1;
    const check = (neighbor: number): void => {
      if (component !== -1) return;
      if (road[neighbor] !== building.ownerId) return;
      const candidate = componentOf[neighbor]!;
      if (candidate !== -1) component = candidate;
    };
    if (x + 1 < width) check(tile + 1);
    if (x - 1 >= 0) check(tile - 1);
    if (y + 1 < height) check(tile + width);
    if (y - 1 >= 0) check(tile - width);
    if (component === -1) continue;
    buildingComponent.set(building.id, component);
    const list = members.get(component);
    if (list) list.push(building.id);
  }

  // Count hubs per component.
  const hubCount = new Map<number, number>();
  for (const building of buildings) {
    const component = buildingComponent.get(building.id);
    if (component === undefined) continue;
    if (!HUB_TYPES.has(building.type)) continue;
    hubCount.set(component, (hubCount.get(component) ?? 0) + 1);
  }

  const connected = new Set<number>();
  for (const building of buildings) {
    if (building.type === "road") continue;
    const component = buildingComponent.get(building.id);
    if (component === undefined) continue;
    const hubs = hubCount.get(component) ?? 0;
    // Factories and airports need a second hub on the network to be useful.
    const needsSecondHub = building.type === "factory" || building.type === "airport";
    if (!needsSecondHub || hubs >= 2) connected.add(building.id);
  }

  const byId = new Map<number, NetworkBuildingRef>();
  for (const building of buildings) byId.set(building.id, building);
  const networkCount = new Map<number, number>();
  for (const [componentId, list] of members) {
    if (list.length === 0) continue;
    const first = byId.get(list[0]!);
    if (!first) continue;
    networkCount.set(first.ownerId, (networkCount.get(first.ownerId) ?? 0) + 1);
  }

  return { connected, componentOf, networkCount, members };
}
