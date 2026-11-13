/**
 * Authoritative game room.
 *
 * One process hosts one persistent match (perfect for a small Render instance):
 *  - the simulation only ever runs here, never in the browser;
 *  - clients send intents, the server validates and applies them at tick
 *    boundaries, then broadcasts a single update to everybody;
 *  - a disconnect hands the nation over to the AI so the world keeps going.
 */

import type { WebSocket } from "ws";
import { GameImpl } from "@openwars/engine";
import type { ClientMessage, GameConfig, ServerMessage } from "@openwars/shared";
import { parseClientMessage } from "./validation";

export interface GameServerOptions {
  config: GameConfig;
  log?: (message: string) => void;
}

interface ClientConnection {
  socket: WebSocket;
  playerId: number;
  joined: boolean;
  messages: number;
  windowStart: number;
}

const MAX_MESSAGES_PER_SECOND = 40;

export class GameServer {
  readonly game: GameImpl;
  private readonly clients = new Set<ClientConnection>();
  private readonly pending: Array<{ playerId: number; message: ClientMessage }> = [];
  private readonly config: GameConfig;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = Date.now();

  constructor(options: GameServerOptions) {
    this.config = options.config;
    this.log = options.log ?? ((message) => console.log(message));
    this.game = new GameImpl(options.config);
  }

  start(): void {
    if (this.timer) return;
    const interval = Math.max(20, Math.round(1000 / this.config.tickRate));
    this.timer = setInterval(() => this.step(), interval);
    this.log(
      `[openwars] match started: ${this.config.width}x${this.config.height} seed=${this.config.seed} style=${this.config.mapStyle}`,
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get humanCount(): number {
    return this.game.allPlayers().filter((player) => !player.isBot && player.alive).length;
  }

  attach(socket: WebSocket): void {
    const client: ClientConnection = {
      socket,
      playerId: 0,
      joined: false,
      messages: 0,
      windowStart: Date.now(),
    };
    this.clients.add(client);

    socket.on("message", (data) => {
      this.onMessage(client, String(data));
    });
    socket.on("close", () => this.onClose(client));
    socket.on("error", () => this.onClose(client));

    this.send(client, { t: "welcome", playerId: 0, snapshot: this.game.snapshot() });
  }

  private onMessage(client: ClientConnection, raw: string): void {
    const now = Date.now();
    if (now - client.windowStart > 1000) {
      client.windowStart = now;
      client.messages = 0;
    }
    client.messages++;
    if (client.messages > MAX_MESSAGES_PER_SECOND) {
      this.send(client, { t: "error", message: "Trop de requêtes, ralentis un peu." });
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      this.send(client, { t: "error", message: "Message invalide." });
      return;
    }

    if (message.t === "join") {
      this.handleJoin(client, message);
      return;
    }
    if (message.t === "spectate") {
      client.playerId = 0;
      client.joined = true;
      this.send(client, { t: "welcome", playerId: 0, snapshot: this.game.snapshot() });
      return;
    }
    if (message.t === "ping") {
      return;
    }
    if (client.playerId === 0) {
      this.send(client, { t: "error", message: "Choisis d'abord une nation." });
      return;
    }
    this.pending.push({ playerId: client.playerId, message });
  }

  private handleJoin(
    client: ClientConnection,
    message: Extract<ClientMessage, { t: "join" }>,
  ): void {
    if (client.playerId !== 0) {
      this.send(client, { t: "error", message: "Tu diriges déjà une nation." });
      return;
    }
    const result = this.game.addPlayer({
      name: message.name,
      countryName: message.countryName,
      flag: message.flag,
      color: message.color,
      government: message.government,
      isBot: false,
    });
    if (!result.ok) {
      this.send(client, { t: "error", message: result.error });
      return;
    }
    client.playerId = result.id;
    client.joined = true;
    this.send(client, { t: "welcome", playerId: result.id, snapshot: this.game.snapshot() });
    this.log(`[openwars] ${message.name} joined as ${message.countryName} (#${result.id})`);
  }

  private onClose(client: ClientConnection): void {
    if (!this.clients.delete(client)) return;
    if (client.playerId !== 0) {
      const player = this.game.get(client.playerId);
      if (player && player.alive) {
        this.game.setController(client.playerId, true);
        this.broadcast({
          t: "info",
          message: `${player.country.flag} ${player.country.name} passe sous contrôle de l'IA (déconnexion).`,
        });
        this.log(`[openwars] player #${client.playerId} disconnected -> AI takeover`);
      }
    }
  }

  private step(): void {
    // No spectator, no player: pause the world instead of burning CPU on a
    // free hosting instance. The match resumes exactly where it stopped.
    if (this.clients.size === 0) {
      this.lastTickAt = Date.now();
      return;
    }
    const now = Date.now();
    const delta = now - this.lastTickAt;
    this.lastTickAt = now;
    if (delta > 2000) {
      // The process was suspended (free hosting): skip the backlog instead of
      // trying to catch up with thousands of ticks.
      this.log(`[openwars] resuming after a ${delta} ms pause`);
    }

    if (this.pending.length > 0) {
      for (const { playerId, message } of this.pending) {
        const error = this.apply(playerId, message);
        if (error) {
          const client = this.clientFor(playerId);
          if (client) this.send(client, { t: "error", message: error });
        }
      }
      this.pending.length = 0;
    }

    const update = this.game.advance();
    this.broadcast({ t: "update", update });
  }

  private clientFor(playerId: number): ClientConnection | undefined {
    for (const client of this.clients) {
      if (client.playerId === playerId) return client;
    }
    return undefined;
  }

  /** Applies one validated intent and returns an error message, if any. */
  private apply(playerId: number, message: ClientMessage): string | null {
    switch (message.t) {
      case "attack":
        return resultOf(this.game.tryAttack(playerId, message.x, message.y, message.troops));
      case "boat":
        return resultOf(
          this.game.trySendBoat(playerId, message.x, message.y, message.troops, message.kind),
        );
      case "build":
        return resultOf(this.game.tryBuild(playerId, message.building, message.x, message.y));
      case "upgrade":
        return resultOf(this.game.tryUpgrade(playerId, message.buildingId));
      case "alliance":
        return resultOf(this.game.tryRequestAlliance(playerId, message.target));
      case "allianceResponse":
        return resultOf(this.game.tryRespondAlliance(playerId, message.from, message.accept));
      case "breakAlliance":
        return resultOf(this.game.tryBreakAlliance(playerId));
      case "gift":
        return resultOf(
          this.game.tryGift(playerId, message.target, message.kind, message.amount),
        );
      case "transferSettings":
        return resultOf(
          this.game.trySetTransferSettings(playerId, message.moneyPercentage, message.troopPercentage),
        );
      case "government":
        return resultOf(this.game.trySetGovernment(playerId, message.government));
      case "tax":
        return resultOf(this.game.trySetTax(playerId, message.rate));
      case "missile":
        return resultOf(this.game.tryLaunchMissile(playerId, message.kind, message.x, message.y));
      default:
        return "Action inconnue.";
    }
  }

  private send(client: ClientConnection, message: ServerMessage): void {
    if (client.socket.readyState !== 1) return;
    try {
      client.socket.send(JSON.stringify(message));
    } catch {
      // Socket closed mid-write: ignore.
    }
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState !== 1) continue;
      try {
        client.socket.send(payload);
      } catch {
        // Ignore broken sockets, the close handler cleans up.
      }
    }
  }
}

function resultOf(result: { ok: boolean; error?: string }): string | null {
  return result.ok ? null : (result.error ?? "Action refusée.");
}
