/**
 * Web Server — Serves the runtime/settings/crons API, chat endpoints, and UI.
 *
 * Routes:
 *   GET  /                        -> HTML frontend
 *   GET  /api/runtime             -> Get current runtime state
 *   GET  /api/settings            -> Get current app settings
 *   PUT  /api/settings            -> Update app settings and reload scheduler
 *   GET  /api/crons               -> List dynamic cron jobs
 *   POST /api/crons               -> Create a dynamic cron job
 *   PUT  /api/crons/:id           -> Update a cron job
 *   DELETE /api/crons/:id         -> Delete a cron job
 *   POST /api/crons/:id/trigger   -> Trigger a cron job manually
 *   GET  /api/status              -> WhatsApp connection status
 *   GET  /api/chats               -> List conversations
 *   GET  /api/chats/:jid          -> Get messages for a conversation
 *   POST /api/chat/send           -> Send a message to a JID
 *   GET  /api/contacts            -> List internal contacts
 *   POST /api/contacts            -> Create an internal contact
 *   PUT  /api/contacts/:jid       -> Update an internal contact
 *   DELETE /api/contacts/:jid     -> Delete an internal contact
 *   GET  /api/media/:jid/:msgId   -> Download stored media
 *
 * Uses Node HTTP plus ws for clean shutdown.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isFailure, type Result } from "../../types/result.ts";
import type { CronService } from "../../infra/cron/make-cron-service.ts";
import type { CronScheduler } from "../../infra/cron/make-cron-scheduler.ts";
import type { MessageStore } from "../../infra/whatsapp/make-message-store.ts";
import type { WhatsAppSessionState } from "../../infra/whatsapp/whatsapp-types.ts";
import type { ContactsRepository } from "../../infra/contacts/make-contacts-repository.ts";
import type { SystemContactSync } from "../../infra/contacts/make-system-contact-sync.ts";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  successResponse,
} from "./http-responses.ts";
import { handleContactsRequest } from "./handle-contacts-request.ts";
import { handleChatsRequest } from "./handle-chats-request.ts";
import { handleCronRequest } from "./handle-cron-request.ts";
import {
  buildStatusSnapshot,
  makeStatusChannel,
} from "./make-status-channel.ts";
import { makeNodeHttpServer } from "./make-node-http-server.ts";
import { normalizeJid } from "./normalize-jid.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WebServerDeps {
  /** Port to listen on */
  port: number;
  /** PostgreSQL-backed cron runtime service */
  cronService: CronService;
  /** CRON scheduler */
  cronScheduler: CronScheduler;
  /** Message store (incoming messages) */
  messageStore: MessageStore;
  /** Internal contacts repository */
  contactsRepository: ContactsRepository;
  /** Send a message to an arbitrary JID */
  sendMessageToJid: (
    jid: string,
    text: string,
  ) => Promise<Result<void, string>>;
  /** Get current WhatsApp connection status */
  getConnectionStatus: () => string;
  /** Get rich WhatsApp session state */
  getSessionState: () => WhatsAppSessionState;
  /** Get current target JID */
  getTargetJid: () => string;
  /** Sync system contacts after cron/settings updates */
  systemContactSync?: SystemContactSync | null;
  /** Get the logged-in account JID */
  getOwnJid: () => string;
  /** Download media from Baileys message */
  downloadMedia?: (
    messageKey: { id: string; remoteJid: string; fromMe: boolean },
    messageContent: Record<string, unknown>,
  ) => Promise<Uint8Array | null>;
  /** Path to HTML frontend file (default: relative to this file) */
  htmlPath?: string;
}

export interface WebServer {
  /** Start the server (non-blocking) */
  start: () => Promise<void>;
  /** Stop the server */
  stop: () => Promise<void>;
  /** Broadcast latest status snapshot to websocket clients */
  broadcastStatus: () => Promise<void>;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

// ─── Factory ───────────────────────────────────────────────────────────────

export const makeWebServer = (deps: WebServerDeps): WebServer => {
  let serverRuntime: Awaited<ReturnType<typeof makeNodeHttpServer>> | null = null;
  const statusChannel = makeStatusChannel({
    cronService: deps.cronService,
    messageStore: deps.messageStore,
    getConnectionStatus: deps.getConnectionStatus,
    getSessionState: deps.getSessionState,
    getTargetJid: deps.getTargetJid,
    getOwnJid: deps.getOwnJid,
  });

  // Resolve HTML path relative to this file
  const htmlPath = deps.htmlPath
    ? resolve(process.cwd(), deps.htmlPath)
    : fileURLToPath(new URL("./web-ui.html", import.meta.url));

  // Read and cache HTML on first request
  let cachedHtml: string | null = null;

  const getHtml = (): string => {
    if (cachedHtml) return cachedHtml;
    try {
      cachedHtml = readFileSync(htmlPath, "utf-8");
    } catch (error) {
      console.error("Error reading HTML:", error);
      cachedHtml =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WhatsApp Bot</title></head><body><h1>Error</h1><p>No se pudo cargar la interfaz.</p></body></html>';
    }
    return cachedHtml;
  };

  // ─── Request Handler ───────────────────────────────────────────────

  const handleRequest = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    // CORS preflight
    if (method === "OPTIONS") {
      return corsHeaders(new Response(null, { status: 204 }));
    }

    try {
      // ─── Frontend ──────────────────────────────────────────────

      if (path === "/" || path === "/index.html") {
        return corsHeaders(
          new Response(getHtml(), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        );
      }

      const cronResponse = await handleCronRequest(req, path, {
        cronService: deps.cronService,
        cronScheduler: deps.cronScheduler,
        systemContactSync: deps.systemContactSync,
        getOwnJid: deps.getOwnJid,
      });
      if (cronResponse) {
        if (method !== "GET") {
          await statusChannel.broadcast();
        }
        return cronResponse;
      }

      // ─── GET /api/status ─────────────────────────────────────

      if (method === "GET" && path === "/api/status") {
        const status = await buildStatusSnapshot({
          cronService: deps.cronService,
          messageStore: deps.messageStore,
          getConnectionStatus: deps.getConnectionStatus,
          getSessionState: deps.getSessionState,
          getTargetJid: deps.getTargetJid,
          getOwnJid: deps.getOwnJid,
        });

        return corsHeaders(successResponse({ ...status }));
      }

      const contactsResponse = await handleContactsRequest(req, path, {
        contactsRepository: deps.contactsRepository,
        messageStore: deps.messageStore,
      });
      if (contactsResponse) {
        return contactsResponse;
      }

      const chatsResponse = await handleChatsRequest(req, path, {
        contactsRepository: deps.contactsRepository,
        messageStore: deps.messageStore,
      });
      if (chatsResponse) {
        return chatsResponse;
      }

      // ─── POST /api/chat/send ─────────────────────────────────

      if (method === "POST" && path === "/api/chat/send") {
        const body = await req.json() as { jid?: string; message?: string };

        if (!body.jid || !body.message) {
          return corsHeaders(errorResponse('Se requiere "jid" y "message"'));
        }

        // Normalize the JID
        const normalizedJid = normalizeJid(body.jid);

        // Validate message length
        if (body.message.length > 4096) {
          return corsHeaders(
            errorResponse(
              "El mensaje es demasiado largo (máx 4096 caracteres)",
            ),
          );
        }

        console.log(`📤 Enviando mensaje a ${normalizedJid}...`);

        const result = await deps.sendMessageToJid(normalizedJid, body.message);

        if (isFailure(result)) {
          console.error(`📤 Error al enviar: ${result.getError()}`);
          return corsHeaders(errorResponse(result.getError()));
        }

        console.log(`📤 Mensaje enviado a ${normalizedJid}`);
        return corsHeaders(successResponse({
          message: "✅ Mensaje enviado correctamente",
          jid: normalizedJid,
        }));
      }

      // ═══════════════════════════════════════════════════════════
      // MEDIA ROUTE
      // ═══════════════════════════════════════════════════════════

      // ─── GET /api/media/:jid/:msgId ──────────────────────────

      if (
        method === "GET" && path.startsWith("/api/media/") && deps.downloadMedia
      ) {
        const parts = path.replace("/api/media/", "").split("/");
        if (parts.length < 2) {
          return corsHeaders(errorResponse("Se requiere jid y msgId"));
        }
        const mediaJid = decodeURIComponent(parts[0]);
        const msgId = decodeURIComponent(parts.slice(1).join("/"));

        // Find the message in the store
        const messages = deps.messageStore.getMessages(mediaJid);
        const msg = messages.find((m) => m.id === msgId);

        if (!msg || !msg.media) {
          return corsHeaders(
            errorResponse("Mensaje no encontrado o sin multimedia", 404),
          );
        }

        const buffer = await deps.downloadMedia(
          msg.media.messageKey,
          msg.media.messageContent,
        );
        if (!buffer) {
          return corsHeaders(
            errorResponse("No se pudo descargar el multimedia", 500),
          );
        }

        return corsHeaders(
          new Response(new Blob([toArrayBuffer(buffer)]), {
            status: 200,
            headers: {
              "Content-Type": msg.media.mimetype || "image/jpeg",
              "Cache-Control": "public, max-age=3600",
            },
          }),
        );
      }

      // ─── 404 ─────────────────────────────────────────────────

      return corsHeaders(
        jsonResponse({ ok: false, error: "Ruta no encontrada" }, 404),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("Error en request:", reason);
      return corsHeaders(errorResponse(`Error interno: ${reason}`, 500));
    }
  };

  // ─── Public API ────────────────────────────────────────────────────

  const start = async (): Promise<void> => {
    if (serverRuntime) return;

    serverRuntime = await makeNodeHttpServer({
      port: deps.port,
      handleRequest,
      handleUpgrade: (request, socket, head) => {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`,
        );

        if (request.method !== "GET" || url.pathname !== "/api/status-stream") {
          socket.destroy();
          return;
        }

        statusChannel.handleUpgrade(request, socket, head);
      },
      onListen: (port) => {
        console.log(`\n═══════════════════════════════════════════`);
        console.log(`  🌐 Web UI:     http://localhost:${port}`);
        console.log(`  📡 API:        http://localhost:${port}/api/`);
        console.log(
          `  ⏰ CRON hora:  ${
            new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })
          }`,
        );
        console.log(`═══════════════════════════════════════════\n`);
      },
    });
  };

  const stop = async (): Promise<void> => {
    if (!serverRuntime) return;

    statusChannel.closeAll();
    await serverRuntime.stop();
    serverRuntime = null;
    console.log("Servidor web detenido");
  };

  return { start, stop, broadcastStatus: statusChannel.broadcast };
};
