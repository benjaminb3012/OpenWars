/**
 * HTTP + WebSocket host.
 *
 * Routes:
 *   GET  /            -> the client (dist/client/index.html)
 *   GET  /healthz     -> health probe for Render
 *   GET  /api/config  -> map/room configuration (used by the menu)
 *   GET  /api/state   -> spectator snapshot (debug / observability)
 *   WS   /ws          -> game socket
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { GameConfig } from "@openwars/shared";
import { GameServer } from "./GameServer";

const here = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(here, "../../");
const clientRoot = resolve(projectRoot, "dist/client");

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function configFromEnv(): GameConfig {
  const style = process.env["MAP_STYLE"];
  return {
    width: Math.max(120, Math.round(numberFromEnv("MAP_WIDTH", 320))),
    height: Math.max(90, Math.round(numberFromEnv("MAP_HEIGHT", 200))),
    seed: Math.round(numberFromEnv("MAP_SEED", 1337)),
    maxPlayers: Math.max(2, Math.round(numberFromEnv("MAX_PLAYERS", 8))),
    bots: Math.max(0, Math.round(numberFromEnv("BOTS", 6))),
    tickRate: Math.max(2, Math.round(numberFromEnv("TICK_RATE", 10))),
    mapStyle:
      style === "archipelago" || style === "pangaea" || style === "continents"
        ? style
        : "continents",
  };
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const gameConfig = configFromEnv();
const gameServer = new GameServer({ config: gameConfig });
gameServer.start();

const httpServer = createServer((request, response) => {
  void handleHttp(request, response);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

httpServer.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "/";
  if (!url.startsWith("/ws")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    gameServer.attach(ws);
  });
});

async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        tick: gameServer.game.tick,
        players: gameServer.game.allPlayers().length,
        humans: gameServer.humanCount,
        clients: gameServer.clientCount,
      }),
    );
    return;
  }
  if (url.pathname === "/api/config") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(gameConfig));
    return;
  }
  if (url.pathname === "/api/state") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(gameServer.game.snapshot()));
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(clientRoot, safePath);
  if (!filePath.startsWith(clientRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
      "content-length": body.length,
    });
    response.end(body);
  } catch {
    // Single page app fallback.
    const indexPath = join(clientRoot, "index.html");
    if (existsSync(indexPath)) {
      const body = await readFile(indexPath);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      response.end(body);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Client not built. Run `npm run build` first.");
  }
}

const port = numberFromEnv("PORT", 3000);
const host = process.env["HOST"] ?? "0.0.0.0";
httpServer.listen(port, host, () => {
  console.log(`[openwars] listening on http://${host}:${port}`);
});

const shutdown = (): void => {
  console.log("[openwars] shutting down");
  gameServer.stop();
  httpServer.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
