import { assert, assertStringIncludes } from "#test-assert";

Deno.test("web-ui exposes llm fallback editor controls in Spanish", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "En caso de error");
  assertStringIncludes(html, "addCronModalFallbackMessage(");
  assertStringIncludes(html, "Agregar otro mensaje");
  assertStringIncludes(html, "fallbackMessages: contentType === \"llm_generated\"");
  assertStringIncludes(html, "getCronFallbackMessagesFromModal(index)");
});

Deno.test("web-ui redesign keeps cron primary data on top and shared variables visible", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'class="form-section cron-modal-primary-section"');
  assertStringIncludes(html, "grid-column: 1 / -1;");
  assertStringIncludes(html, 'class="cron-modal-template-shell cron-modal-message-shell"');
  assertStringIncludes(html, 'class="cron-modal-variable-hub"');
  assertStringIncludes(html, "Variables disponibles");
  assertStringIncludes(html, "<code>{{date}}</code>");
  assertStringIncludes(html, "<code>{{payment_category_summary}}</code>");
});

Deno.test("web-ui renders ordered cron message sequence editor", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'id="cron-modal-message-list"');
  assertStringIncludes(html, 'id="cron-modal-message-count"');
  assertStringIncludes(html, 'id="cron-modal-toggle-optional-messages"');
  assertStringIncludes(html, "1 de 4 mensajes configurados");
  assertStringIncludes(html, 'onclick="addCronModalMessage()"');
  assertStringIncludes(html, 'onclick="toggleCronModalOptionalMessages()"');
  assertStringIncludes(html, 'onclick="moveCronModalMessage(');
  assertStringIncludes(html, 'onclick="removeCronModalMessage(');
  assertStringIncludes(html, 'cron-add-message-button');
});

Deno.test("web-ui redesign uses segmented content type controls inside message config card", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "cron-message-config-card");
  assertStringIncludes(html, "cron-message-editor-card");
  assertStringIncludes(html, "cron-segmented-control");
  assertStringIncludes(html, "cron-segmented-button");
  assertStringIncludes(html, ", \\'static_template\\')\">Plantilla</button>");
  assertStringIncludes(html, ", \\'llm_generated\\')\">Gemini</button>");
  assertStringIncludes(html, "Configuración");
  assertStringIncludes(html, "Editor de plantilla");
});

Deno.test("web-ui builds messages[] payloads and hydrates legacy cron data", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "messages,");
  assertStringIncludes(html, "executionMode:");
  assertStringIncludes(html, "function hydrateCronJobMessages(cronJob)");
  assertStringIncludes(html, "return [normalizeCronModalMessage(cronJob)];");
  assertStringIncludes(html, "function syncCronJobLegacyFields(cronJob)");
});

Deno.test("web-ui exposes cron execution mode selector", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'id="cron-modal-execution-mode"');
  assertStringIncludes(html, 'value="sequence"');
  assertStringIncludes(html, 'value="random_single"');
  assertStringIncludes(html, "Enviar la secuencia completa");
  assertStringIncludes(html, "Enviar un solo mensaje aleatorio");
});

Deno.test("web-ui caps cron modal messages at four items", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "const MAX_CRON_MESSAGES = 4;");
  assertStringIncludes(html, "let showOptionalCronMessageBlocks = false;");
  assertStringIncludes(html, 'Mostrar bloques opcionales (');
  assertStringIncludes(html, 'Ocultar bloques opcionales');
  assertStringIncludes(html, "addButton.disabled = cronModalMessages.length >= MAX_CRON_MESSAGES;");
  assertStringIncludes(html, "toggleButton.disabled = getCronOptionalMessageCount() === 0;");
  assertStringIncludes(html, "if (cronModalMessages.length >= MAX_CRON_MESSAGES) return;");
});

Deno.test("web-ui keeps optional cron message blocks hidden until requested", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "showOptionalCronMessageBlocks = false;");
  assertStringIncludes(html, "if (!showOptionalCronMessageBlocks) return \"\";");
  assertStringIncludes(html, 'data-cron-optional-message-card="');
  assertStringIncludes(html, "Bloque opcional oculto por defecto.");
});

Deno.test("web-ui blocks repeated cron trigger clicks while loading", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "const loadingCronJobIds = new Set();");
  assertStringIncludes(html, 'if (loadingCronJobIds.has(id)) {');
  assertStringIncludes(html, "setCronJobTriggerLoading(id, true);");
  assertStringIncludes(html, "setCronJobTriggerLoading(id, false);");
  assertStringIncludes(html, "renderCronTriggerButton(cardId)");
  assertStringIncludes(html, "<span class=\"spinner\"></span>");
  assertStringIncludes(html, '" aria-busy="');
  assertStringIncludes(html, "(isLoading ? ' disabled' : '')");
});

Deno.test("web-ui persists cron card order with localStorage helpers", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'const CRON_ORDER_STORAGE_KEY = "cron-card-order";');
  assertStringIncludes(html, "function readCronJobOrder() {");
  assertStringIncludes(html, "localStorage.getItem(CRON_ORDER_STORAGE_KEY)");
  assertStringIncludes(html, "function reconcileCronJobOrder(cronJobs) {");
  assertStringIncludes(html, "const persistedIds = storedOrder.filter((id) => liveIds.includes(id));");
  assertStringIncludes(html, "const newIds = liveIds.filter((id) => !persistedIds.includes(id));");
  assertStringIncludes(html, "function moveCronJobOrder(draggedId, targetId) {");
  assertStringIncludes(html, "writeCronJobOrder(orderedIds);");
  assertStringIncludes(html, "const orderedCronJobs = getOrderedCronJobs(cronJobs);");
});

Deno.test("web-ui exposes drag-and-drop hooks only on persisted cron cards", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'ondragover="allowCronListDrop(event)"');
  assertStringIncludes(html, 'ondrop="dropCronJob(event)"');
  assertStringIncludes(html, 'data-cron-draggable');
  assertStringIncludes(html, '(isDraggable ? \' draggable="true"\' : "")');
  assertStringIncludes(html, 'startCronDrag(event, ');
  assertStringIncludes(html, 'allowCronCardDrop(event, ');
  assertStringIncludes(html, 'dropCronJob(event, ');
  assertStringIncludes(html, 'ondragend="endCronDrag()"');
  assertStringIncludes(html, 'cron-card-drag-handle');
  assertStringIncludes(html, 'const isDraggable = !isDraft;');
});

Deno.test("web-ui adds pointer-based mobile drag hooks to the cron handle", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "let cronTouchDragPointerId = null;");
  assertStringIncludes(html, "let cronTouchDragMoved = false;");
  assertStringIncludes(html, 'data-cron-touch-handle="true"');
  assertStringIncludes(html, 'onpointerdown="startCronTouchDrag(event, \\\'');
  assertStringIncludes(html, 'onpointermove="moveCronTouchDrag(event)"');
  assertStringIncludes(html, 'onpointerup="endCronTouchDrag(event)"');
  assertStringIncludes(html, 'onpointercancel="cancelCronTouchDrag(event)"');
  assertStringIncludes(html, 'function startCronTouchDrag(event, id) {');
  assertStringIncludes(html, 'if (event.pointerType !== "touch" && event.pointerType !== "pen") return;');
  assertStringIncludes(html, 'function getCronDropTargetFromPoint(clientX, clientY) {');
  assertStringIncludes(html, 'document.elementFromPoint(clientX, clientY)');
  assertStringIncludes(html, 'function moveCronTouchDrag(event) {');
  assertStringIncludes(html, 'function endCronTouchDrag(event) {');
  assertStringIncludes(html, 'function cancelCronTouchDrag(event) {');
});

Deno.test("web-ui adds visual drag feedback hints for cron reordering", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'id="cron-drag-hint"');
  assertStringIncludes(html, 'id="cron-drag-hint-text"');
  assertStringIncludes(
    html,
    'Arrastra, o mantén el asa en móvil, para reordenar la lista.',
  );
  assertStringIncludes(html, 'Suelta para mover el cron en esta posición.');
  assertStringIncludes(html, 'cron-list-section--dragging');
  assertStringIncludes(html, 'cron-drag-hint--active');
  assertStringIncludes(html, 'cron-card--draggable:hover .cron-card-drag-handle');
  assertStringIncludes(html, 'cron-card--dragging .cron-card-drag-handle');
  assertStringIncludes(html, 'cron-card--drop-target .cron-card-drag-handle');
  assertStringIncludes(html, 'touch-action: none;');
});

Deno.test("web-ui tracks llm usage from ordered messages in summary cards", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, '(entry.messages || []).some(');
  assertStringIncludes(html, 'message.contentType === "llm_generated"');
});

Deno.test("web-ui lets the draft card forward drops to the first persisted cron", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'const dropTargetId = options.dropTargetId || (isDraggable ? cardId : "");');
  assertStringIncludes(html, 'data-cron-drop-target');
  assertStringIncludes(html, 'dropTargetId === dragOverCronJobId');
  assertStringIncludes(html, 'dropTargetId: orderedCronJobs[0]?.id || "",');
  assertStringIncludes(html, 'escapeJs(dropTargetId)');
  assertStringIncludes(html, '" data-cron-drop-target="');
  assertStringIncludes(html, "allowCronCardDrop(event, \\");
  assertStringIncludes(html, "dropCronJob(event, \\");
});

Deno.test("web-ui documents payment category summary template variable", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "<code>{{payment_category_summary}}</code>");
  assertStringIncludes(html, "Usa el panel de variables para copiar rápidamente los placeholders admitidos.");
});

Deno.test("web-ui exposes reconnect banner and blocking relink screen", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'id="reconnect-banner"');
  assertStringIncludes(html, 'id="session-overlay"');
  assertStringIncludes(html, 'id="session-qr-image"');
  assertStringIncludes(html, 'Esperando el próximo código QR...');
  assertStringIncludes(html, 'Escanea el QR para reconectar');
});

Deno.test("web-ui keeps polished cron segmented controls and add-message button styling", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, ".cron-segmented-control {");
  assertStringIncludes(html, "background: linear-gradient(180deg, var(--bg-alt), var(--surface));");
  assertStringIncludes(html, ".cron-segmented-button.active {");
  assertStringIncludes(html, "box-shadow: 0 0 0 1px var(--green-subtle), var(--shadow-sm);");
  assertStringIncludes(html, ".cron-add-message-button {");
  assertStringIncludes(html, "box-shadow: inset 0 1px 0 oklch(1 0.004 85 / 0.6);");
  assertStringIncludes(html, "transform: translateY(-1px);");
});

Deno.test("web-ui adapts status polling from session phase metadata", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, "const SESSION_POLL_INTERVALS = {");
  assertStringIncludes(html, 'connected: 15000');
  assertStringIncludes(html, 'reconnecting: 5000');
  assertStringIncludes(html, 'qr_pending: 5000');
  assertStringIncludes(html, 'relink_required: 5000');
  assertStringIncludes(html, "function normalizeSessionState(session, whatsapp)");
  assertStringIncludes(html, "if (!statusSocketFallbackActive) return;");
  assertStringIncludes(html, "scheduleStatusPoll(getStatusPollDelay(currentSession));");
  assertStringIncludes(html, "applyStatusPayload(d);");
});

Deno.test("web-ui prefers websocket status and pauses background polling when hidden", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'new WebSocket(protocol + "//" + window.location.host + "/api/status-stream")');
  assertStringIncludes(html, "statusSocketFallbackActive = false;");
  assertStringIncludes(html, "document.addEventListener(\"visibilitychange\"");
  assertStringIncludes(html, "if (document.hidden) return;");
  assertStringIncludes(html, "closeStatusSocket();");
});

Deno.test("web-ui exposes destructive WhatsApp unlink action in header with confirmation modal", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'class="header-actions"');
  assertStringIncludes(html, 'id="header-unlink-whatsapp-btn"');
  assertStringIncludes(html, 'class="header-icon-button"');
  assertStringIncludes(html, 'onclick="openUnlinkWhatsAppModal()"');
  assertStringIncludes(html, 'id="unlink-whatsapp-modal"');
  assertStringIncludes(html, 'id="unlink-whatsapp-title"');
  assertStringIncludes(html, 'id="unlink-whatsapp-confirm-btn"');
  assertStringIncludes(html, 'id="unlink-whatsapp-cancel-btn"');
  assertStringIncludes(html, "Desvincular WhatsApp");
  assertStringIncludes(html, "Desvincular");
  assertStringIncludes(html, "Se cerrará la sesión actual de este equipo");
  assertStringIncludes(html, "nuevo QR.");
  assertStringIncludes(html, 'id="unlink-whatsapp-error"');
  assertStringIncludes(html, 'currentSession?.phase !== "connected"');
});

Deno.test("web-ui opens unlink modal and posts to /api/whatsapp/unlink with loading reset", async () => {
  const html = await Deno.readTextFile(
    new URL("../web-ui.html", import.meta.url),
  );

  assertStringIncludes(html, 'document.getElementById("unlink-whatsapp-modal").style.display = "flex"');
  assertStringIncludes(html, 'document.getElementById("unlink-whatsapp-modal").style.display = "none"');
  assertStringIncludes(html, 'closeUnlinkWhatsAppModal()');
  assertStringIncludes(html, 'await apiPost("/api/whatsapp/unlink")');
  assertStringIncludes(html, 'unlinkWhatsAppError = "";');
  assertStringIncludes(html, 'unlinkWhatsAppLoading = true;');
  assertStringIncludes(html, 'unlinkWhatsAppLoading = false;');
  assertStringIncludes(html, 'currentSession?.phase !== "connected"');
});
