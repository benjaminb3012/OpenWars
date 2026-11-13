/**
 * Simulation benchmark.
 *
 * Usage: npx tsx scripts/bench.mjs [width] [height] [players]
 * Prints the per-tick cost and the size of a serialised update packet.
 */

import { GameImpl } from "../packages/engine/src/game/GameImpl.ts";

const width = Number(process.argv[2] ?? 320);
const height = Number(process.argv[3] ?? 200);
const players = Number(process.argv[4] ?? 8);

const game = new GameImpl({
  width,
  height,
  seed: 1337,
  maxPlayers: players,
  bots: players,
  tickRate: 10,
  mapStyle: "continents",
});

const mapTime = performance.now();
game.snapshot();
console.log(`map ${width}x${height} generated in ${(performance.now() - mapTime).toFixed(0)} ms, land ${game.map.landTiles}`);

// Let the bots settle so territorial waves happen on a populated map.
for (let i = 0; i < 600; i++) game.advance();

const runs = 600;
let bytes = 0;
let maxPacket = 0;
const start = performance.now();
for (let i = 0; i < runs; i++) {
  const update = game.advance();
  if (i % 10 === 0) {
    const size = JSON.stringify({ t: "update", update }).length;
    bytes += size;
    if (size > maxPacket) maxPacket = size;
  }
}
const elapsed = performance.now() - start;
console.log(`ticks: ${runs} in ${elapsed.toFixed(0)} ms -> ${(elapsed / runs).toFixed(3)} ms/tick`);
console.log(`update packet: avg ${(bytes / (runs / 10) / 1024).toFixed(1)} kB, max ${(maxPacket / 1024).toFixed(1)} kB`);
console.log(
  `nations: ${game
    .allPlayers()
    .map((player) => `${player.country.name}:${player.tiles}`)
    .join(" ")}`,
);
console.log(`tiles owned: ${game.index.totalOwned()} / ${game.map.landTiles} land`);
