import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { isFailure } from "../../types/result.ts";
import type { CronService } from "../../infra/cron/make-cron-service.ts";
import type { MessageStore } from "../../infra/whatsapp/make-message-store.ts";
import type { WhatsAppSessionState } from "../../infra/whatsapp/whatsapp-types.ts";

export interface StatusSnapshot {
  whatsapp: string;
  session: WhatsAppSessionState;
  targetJid: string;
  ownJid: string;
  timezone: string;
  defaultTargetJid: string;
  cronCount: number;
  unread: number;
}

export interface StatusSnapshotDeps {
  cronService: CronService;
  messageStore: MessageStore;
  getConnectionStatus: () => string;
  getSessionState: () => WhatsAppSessionState;
  getTargetJid: () => string;
  getOwnJid: () => string;
}

const createStatusEvent = (payload: StatusSnapshot): string => {
  return JSON.stringify({ type: "status", payload });
};

export const buildStatusSnapshot = async (
  deps: StatusSnapshotDeps,
): Promise<StatusSnapshot> => {
  const runtimeResult = await deps.cronService.getRuntimeState();
  const runtime = isFailure(runtimeResult) ? null : runtimeResult.getValue();
  const defaultTargetJid = runtime?.settings.defaultTargetJid ?? "";

  return {
    whatsapp: deps.getConnectionStatus(),
    session: deps.getSessionState(),
    targetJid: defaultTargetJid || deps.getTargetJid() || "No configurado",
    ownJid: deps.getOwnJid(),
    timezone: runtime?.settings.timezone ?? "America/Caracas",
    defaultTargetJid,
    cronCount: runtime?.cronJobs.length ?? 0,
    unread: deps.messageStore.getTotalUnread(),
  };
};

export const makeStatusChannel = (deps: StatusSnapshotDeps) => {
  const server = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();

  const sendSnapshot = async (socket: WebSocket): Promise<void> => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(createStatusEvent(await buildStatusSnapshot(deps)));
  };

  const broadcast = async (): Promise<void> => {
    if (!sockets.size) return;

    const message = createStatusEvent(await buildStatusSnapshot(deps));

    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        sockets.delete(socket);
        continue;
      }

      try {
        socket.send(message);
      } catch {
        sockets.delete(socket);
      }
    }
  };

  const handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    server.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      const release = (): void => {
        sockets.delete(websocket);
      };

      sockets.add(websocket);
      void sendSnapshot(websocket);
      websocket.on("close", release);
      websocket.on("error", release);
    });
  };

  const closeAll = (): void => {
    for (const socket of sockets) {
      try {
        socket.close(1001, "server-stopping");
      } catch {
        // Ignore close errors during shutdown.
      }
    }

    sockets.clear();
  };

  return {
    handleUpgrade,
    broadcast,
    closeAll,
  };
};
