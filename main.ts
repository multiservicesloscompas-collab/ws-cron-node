import { failure, isFailure } from "./types/result.ts";
import {
  makeWhatsAppClient,
  type WASocket,
} from "./infra/whatsapp/make-whatsapp-client.ts";
import { makeSendMessage } from "./infra/whatsapp/make-send-message.ts";
import { makeGroupFinder } from "./infra/whatsapp/make-group-finder.ts";
import { makeMessageStore } from "./infra/whatsapp/make-message-store.ts";
import { makeCronScheduler } from "./infra/cron/make-cron-scheduler.ts";
import { makeCronService, type CronService } from "./infra/cron/make-cron-service.ts";
import { makeCronJobsRepository } from "./infra/cron/make-cron-jobs-repository.ts";
import { makeAppSettingsRepository } from "./infra/cron/make-app-settings-repository.ts";
import { makeLegacyCronImporter } from "./infra/cron/make-legacy-cron-importer.ts";
import { makeCronMessageRenderer } from "./infra/cron/make-cron-message-renderer.ts";
import { syncCronTargetContacts } from "./infra/cron/sync-cron-target-contacts.ts";
import { makeWebServer } from "./app/web/make-web-server.ts";
import {
  getSupabaseEnv,
  makeSupabaseClient,
} from "./infra/supabase/make-supabase-client.ts";
import { makeRentalsRepository } from "./infra/supabase/make-rentals-repository.ts";
import { makeSalesRepository } from "./infra/supabase/make-sales-repository.ts";
import { makeExchangeRateRepository } from "./infra/supabase/make-exchange-rate-repository.ts";
import { makeSalesReportService } from "./domain/services/make-sales-report-service.ts";
import { makeChecklistService } from "./domain/services/make-checklist-service.ts";
import { makeMediaDownloader } from "./infra/whatsapp/make-media-downloader.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  makeContactsRepository,
  type ContactsRepository,
} from "./infra/contacts/make-contacts-repository.ts";
import { makeSystemContactSync } from "./infra/contacts/make-system-contact-sync.ts";
import { getGeminiEnv } from "./infra/llm/get-gemini-env.ts";
import { makeGeminiApiKeyAdapter } from "./infra/llm/make-gemini-api-key-adapter.ts";
import {
  getPostgresEnv,
} from "./infra/postgres/get-postgres-env.ts";
import {
  makePostgresDb,
  type PostgresDb,
} from "./infra/postgres/make-postgres-db.ts";

let _sendMessage: ReturnType<typeof makeSendMessage> | null = null;
let _bootstrapPromise: Promise<void> | null = null;
let _webServer: ReturnType<typeof makeWebServer> | null = null;
let _client: ReturnType<typeof makeWhatsAppClient> | null = null;
let _cronScheduler: ReturnType<typeof makeCronScheduler> | null = null;
let _cronService: CronService | null = null;
let _messageStore: ReturnType<typeof makeMessageStore> | null = null;
let _supabase: SupabaseClient | null = null;
let _rentalsRepo: ReturnType<typeof makeRentalsRepository> | null = null;
let _salesRepo: ReturnType<typeof makeSalesRepository> | null = null;
let _exchangeRateRepo: ReturnType<typeof makeExchangeRateRepository> | null =
  null;
let _salesReportService: ReturnType<typeof makeSalesReportService> | null =
  null;
let _checklistService: ReturnType<typeof makeChecklistService> | null = null;
let _postgresDb: PostgresDb | null = null;
let _contactsRepository: ContactsRepository | null = null;
let _systemContactSync: ReturnType<typeof makeSystemContactSync> | null = null;
let _targetJid = "";

const getTargetJid = (): string => _targetJid;
const setTargetJid = (jid: string) => {
  _targetJid = jid;
};

const getWebServerPort = (): number => {
  const fallbackPort = 3000;
  const port = Number(process.env.PORT ?? fallbackPort);

  return Number.isInteger(port) && port > 0 ? port : fallbackPort;
};

const broadcastStatus = (): void => {
  void _webServer?.broadcastStatus();
};

export const getSupabase = (): SupabaseClient => {
  if (!_supabase) throw new Error("Supabase no inicializado");
  return _supabase;
};

export const getRentalsRepo = (): ReturnType<typeof makeRentalsRepository> => {
  if (!_rentalsRepo) {
    throw new Error("Repositorio de alquileres no inicializado");
  }
  return _rentalsRepo;
};

export const getSalesReportService = (): ReturnType<
  typeof makeSalesReportService
> => {
  if (!_salesReportService) {
    throw new Error("Servicio de reportes no inicializado");
  }
  return _salesReportService;
};

export const getChecklistService = (): ReturnType<
  typeof makeChecklistService
> => {
  if (!_checklistService) {
    throw new Error("Servicio de checklist no inicializado");
  }
  return _checklistService;
};

export const getSendMessage = (): ReturnType<typeof makeSendMessage> => {
  if (!_sendMessage) throw new Error("WhatsApp no iniciado");
  return _sendMessage;
};

export const ensureBootstrapped = async (): Promise<void> => {
  if (!_bootstrapPromise) {
    _bootstrapPromise = bootstrap();
  }
  await _bootstrapPromise;
};

const bootstrap = async () => {
  console.log("═══════════════════════════════════════════");
  console.log("  Multiservicio Los Compas — WhatsApp Bot");
  console.log("═══════════════════════════════════════════\n");

  console.log("[1/6] Inicializando PostgreSQL y contactos internos...");
  const postgresResult = await makePostgresDb(getPostgresEnv());

  if (isFailure(postgresResult)) {
    throw new Error(postgresResult.getError());
  }

  _postgresDb = postgresResult.getValue();
  _contactsRepository = makeContactsRepository({ database: _postgresDb.pool });
  _systemContactSync = makeSystemContactSync(_contactsRepository);

  const appSettingsRepository = makeAppSettingsRepository({
    database: _postgresDb.pool,
  });
  const cronJobsRepository = makeCronJobsRepository({
    database: _postgresDb.pool,
  });

  const importer = makeLegacyCronImporter({
    configPath: "./config/cron-config.json",
    database: _postgresDb,
    appSettingsRepository,
    cronJobsRepository,
  });
  const importResult = await importer.importIfEmpty();
  if (isFailure(importResult)) {
    console.log(`  ⚠️  No se pudo importar el cron legacy: ${importResult.getError()}`);
  } else if (importResult.getValue() === "imported") {
    console.log("  ✅ Configuración legacy importada a PostgreSQL");
  }

  _cronService = makeCronService({
    appSettingsRepository,
    cronJobsRepository,
  });

  const initialRuntimeResult = await _cronService.getRuntimeState();
  if (isFailure(initialRuntimeResult)) {
    throw new Error(initialRuntimeResult.getError());
  }

  const initialRuntime = initialRuntimeResult.getValue();
  setTargetJid(initialRuntime.settings.defaultTargetJid);

  console.log("[2/6] Inicializando Supabase...");
  const supabaseEnv = getSupabaseEnv();
  const supabaseResult = makeSupabaseClient(supabaseEnv);

  if (isFailure(supabaseResult)) {
    console.log(
      `  ⚠️  Error al conectar Supabase: ${supabaseResult.getError()}`,
    );
    console.log("  💡 El bot funcionará sin datos de Supabase");
  } else {
    _supabase = supabaseResult.getValue().client;
    _rentalsRepo = makeRentalsRepository({ supabase: _supabase });
    _salesRepo = makeSalesRepository({ supabase: _supabase });
    _exchangeRateRepo = makeExchangeRateRepository({ supabase: _supabase });
    console.log("  ✅ Supabase conectado correctamente");

    const pendingResult = await _rentalsRepo.getPendingPickups();
    if (!isFailure(pendingResult)) {
      const pending = pendingResult.getValue();
      if (pending.length > 0) {
        console.log(
          `  📋 ${pending.length} lavadora(s) pendiente(s) de retiro`,
        );
        for (const r of pending) {
          const status = r.isPaid ? "✅ Pagó" : "❌ No pagó";
          console.log(
            `     ${r.machineLabel} — ${r.customer?.name} — ${status}`,
          );
        }
      } else {
        console.log("  ✅ No hay lavadoras pendientes de retiro");
      }
    }
  }

  console.log("[3/6] Inicializando servicios de reportes...");
  if (_salesRepo && _exchangeRateRepo) {
    _salesReportService = makeSalesReportService({
      salesRepo: _salesRepo,
      exchangeRateRepo: _exchangeRateRepo,
    });
    _checklistService = makeChecklistService({
      rentalsRepo: _rentalsRepo!,
    });
    console.log("  ✅ Servicios de reportes inicializados");
  } else {
    console.log("  ⚠️  Servicios de reportes no disponibles (sin Supabase)");
  }

  console.log("[4/6] Inicializando programador CRON...");
  const llmAdapter = makeGeminiApiKeyAdapter(getGeminiEnv());
  const messageRenderer = makeCronMessageRenderer({
    llmAdapter,
    buildMorningMessage: _checklistService
      ? (date?: string, template?: string) =>
        _checklistService!.buildMorningMessage(date, template)
      : undefined,
    buildNightMessage: _salesReportService
      ? (date?: string, template?: string, time?: string) =>
        _salesReportService!.buildNightMessage(
          date || new Date().toISOString().slice(0, 10),
          template,
          time,
        )
      : undefined,
  });

  _cronScheduler = makeCronScheduler({
    sendMessage: async (jid: string, text: string) => {
      if (!_sendMessage) return failure("WhatsApp no iniciado");
      return _sendMessage(jid, text);
    },
    messageRenderer,
    onTriggered: (cronJobId: string) => {
      void _cronService?.markTriggered(cronJobId);
    },
  });

  _cronScheduler.startAll(initialRuntime);

  console.log("[5/6] Iniciando servidor web...");
  _messageStore = makeMessageStore();
  _messageStore.subscribe(() => {
    broadcastStatus();
  });
  const mediaDownloader = makeMediaDownloader({
    getSocket: () => _client ? _client.getSocket() : null,
  });

  _webServer = makeWebServer({
    port: getWebServerPort(),
    cronService: _cronService,
    cronScheduler: _cronScheduler,
    messageStore: _messageStore,
    contactsRepository: _contactsRepository,
    sendMessageToJid: async (jid, text) => {
      const fn = _sendMessage ||
        (() => Promise.resolve(failure("WhatsApp no iniciado")));
      return fn(jid, text);
    },
    getConnectionStatus: () =>
      _client ? _client.getConnectionStatus() : "closed",
    getSessionState: () =>
      _client
        ? _client.getSessionState()
        : {
          connectionStatus: "closed",
          phase: "disconnected",
          requiresUserAction: false,
          canAutoReconnect: false,
          reconnectAttempt: 0,
          nextReconnectDelayMs: null,
          qr: null,
          qrDataUrl: null,
          qrGeneratedAt: null,
          lastDisconnectCode: null,
          updatedAt: new Date().toISOString(),
        },
    getTargetJid,
    systemContactSync: _systemContactSync,
    getOwnJid: () => _client ? _client.getOwnJid() : "",
    downloadMedia: (key, content) => mediaDownloader.download(key, content),
    unlinkWhatsAppSession: async () => {
      if (!_client) {
        return failure("No hay una sesión activa de WhatsApp para desvincular.");
      }

      return _client.unlink();
    },
  });

  await _webServer.start();
  broadcastStatus();

  console.log("[6/6] Iniciando WhatsApp Client...");
  _client = makeWhatsAppClient({
    authFolder: "auth_info",
    database: _postgresDb.pool,
    onSocket: (socket: WASocket) => {
      _messageStore?.startListening(socket);
      broadcastStatus();
    },
    onSessionStateChange: () => {
      broadcastStatus();
    },
    onConnectionOpen: (ownJid: string) => {
      broadcastStatus();
      void (async () => {
        await _systemContactSync?.syncOwnContact(ownJid);
        const runtimeResult = _cronService
          ? await _cronService.getRuntimeState()
          : null;
        if (!runtimeResult || isFailure(runtimeResult)) return;
        await syncCronTargetContacts(
          runtimeResult.getValue(),
          _systemContactSync,
          ownJid,
        );
      })();
    },
  });
  await _client.start();
  console.log(`  Estado: ${_client.getConnectionStatus()}`);
  broadcastStatus();

  console.log("[6.1/6] Configurando servicios post-conexión...");
  const sendMessage = makeSendMessage({ getSocket: _client.getSocket });
  _sendMessage = sendMessage;
  const findGroup = makeGroupFinder({
    getSocket: _client.getSocket,
    getConnectionStatus: _client.getConnectionStatus,
  });

  console.log('  Buscando grupo "Multiservicio Los Compas"...');
  const groupResult = await findGroup("Multiservicio Los Compas");

  if (isFailure(groupResult)) {
    console.log(`  ⚠️  Grupo no encontrado: ${groupResult.getError()}`);
    console.log("  💡 Configura el JID manualmente desde la Web UI");
  } else {
    const groupJid = groupResult.getValue();
    console.log(`  ✅ Grupo encontrado: ${groupJid}`);
    setTargetJid(groupJid);
    broadcastStatus();
    await _systemContactSync?.syncTargetContact(groupJid, "detected-group");

    if (_cronService) {
      const runtimeResult = await _cronService.getRuntimeState();
      if (!isFailure(runtimeResult)) {
        const runtime = runtimeResult.getValue();
        if (runtime.settings.defaultTargetJid !== groupJid) {
          const updatedState = await _cronService.updateSettings({
            defaultTargetJid: groupJid,
            timezone: runtime.settings.timezone,
          });

          if (!isFailure(updatedState)) {
            setTargetJid(updatedState.getValue().settings.defaultTargetJid);
            broadcastStatus();
            await syncCronTargetContacts(
              updatedState.getValue(),
              _systemContactSync,
              _client?.getOwnJid(),
            );
            _cronScheduler?.reload(updatedState.getValue());
          }
        }
      }
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  ✅ Sistema listo");
  console.log("═══════════════════════════════════════════\n");
};

const shutdown = async () => {
  console.log("\nDeteniendo sistema...");
  if (_cronScheduler) _cronScheduler.stopAll();
  if (_webServer) await _webServer.stop();
  if (_postgresDb) await _postgresDb.close();
  console.log("Sistema detenido. ¡Hasta luego!");
};

process.on("SIGINT", () => {
  void shutdown().finally(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => {
    process.exit(0);
  });
});

export { bootstrap };
export type { WhatsAppClient } from "./infra/whatsapp/make-whatsapp-client.ts";

if (import.meta.main) {
  bootstrap().catch((error) => {
    console.error("💥 Error fatal:", error);
    process.exit(1);
  });
}
