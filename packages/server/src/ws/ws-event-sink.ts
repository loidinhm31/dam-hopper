import type { WebSocket } from "@fastify/websocket";
import type { EventSink } from "./event-sink.js";

/** Fan-out PTY events to all connected WebSocket clients. */
export class WebSocketEventSink implements EventSink {
  private readonly clients = new Set<WebSocket>();

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  sendTerminalData(sessionId: string, data: string): void {
    const msg = JSON.stringify({ type: "terminal:data", id: sessionId, data });
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  sendTerminalExit(sessionId: string, exitCode: number | null): void {
    const msg = JSON.stringify({
      type: "terminal:exit",
      id: sessionId,
      exitCode,
    });
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  sendTerminalChanged(): void {
    this.broadcast("terminal:changed", {});
  }

  /** Send any arbitrary push event to all clients (e.g. git:progress). */
  broadcast(type: string, payload: unknown): void {
    const msg = JSON.stringify({ type, payload });
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
