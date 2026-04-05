import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { PtySessionManager } from "../pty/session-manager.js";
import { WebSocketEventSink } from "./ws-event-sink.js";
import { validateToken } from "../auth/token.js";

interface WsMessage {
  type: string;
  id?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

export function registerWsHandler(
  app: FastifyInstance,
  ptyManager: PtySessionManager,
  eventSink: WebSocketEventSink,
  getToken: () => string,
): void {
  app.get(
    "/ws",
    { websocket: true },
    (socket: WebSocket, request) => {
      // Validate auth cookie before allowing WebSocket communication
      const cookie = (request.cookies as Record<string, string | undefined>)[
        "devhub-auth"
      ];
      if (!cookie || !validateToken(cookie, getToken())) {
        socket.close(4001, "Unauthorized");
        return;
      }

      eventSink.addClient(socket);

      socket.on("message", (raw: Buffer | string) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(raw.toString()) as WsMessage;
        } catch {
          return; // ignore malformed messages
        }

        switch (msg.type) {
          case "terminal:write":
            if (msg.id && typeof msg.data === "string") {
              ptyManager.write(msg.id, msg.data);
            }
            break;

          case "terminal:resize":
            if (msg.id && typeof msg.cols === "number" && typeof msg.rows === "number") {
              const safeCols = Math.max(1, Math.min(msg.cols, 500));
              const safeRows = Math.max(1, Math.min(msg.rows, 500));
              ptyManager.resize(msg.id, safeCols, safeRows);
            }
            break;

          default:
            // Unknown message type — ignore
            break;
        }
      });

      socket.on("close", () => {
        eventSink.removeClient(socket);
      });
    },
  );
}
