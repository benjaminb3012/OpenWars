/** WebSocket client with automatic reconnection. */

import type { ClientMessage, ServerMessage } from "@openwars/shared";

export interface NetHandlers {
  onWelcome: (message: Extract<ServerMessage, { t: "welcome" }>) => void;
  onUpdate: (message: Extract<ServerMessage, { t: "update" }>) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onStatus: (connected: boolean) => void;
}

export class Net {
  private socket: WebSocket | null = null;
  private retry = 0;
  private closedByUser = false;
  private pendingJoin: ClientMessage | null = null;

  constructor(
    private readonly handlers: NetHandlers,
    private readonly url: string = defaultUrl(),
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.handlers.onStatus(false);
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus(true);
      if (this.pendingJoin) this.send(this.pendingJoin);
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (message.t) {
        case "welcome":
          this.handlers.onWelcome(message);
          break;
        case "update":
          this.handlers.onUpdate(message);
          break;
        case "error":
          this.handlers.onError(message.message);
          break;
        case "info":
          this.handlers.onInfo(message.message);
          break;
      }
    };
    socket.onclose = () => {
      this.handlers.onStatus(false);
      if (this.closedByUser) return;
      this.retry = Math.min(this.retry + 1, 6);
      const delay = 500 * this.retry;
      window.setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  /** Remembers the join message so a reconnect restores the session. */
  join(message: ClientMessage): void {
    this.pendingJoin = message;
    this.send(message);
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
  }
}

function defaultUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}
