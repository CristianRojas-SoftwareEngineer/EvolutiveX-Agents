// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/lib/voice-name.ts
var DEFAULT_VOICE = "default";
function normalizeVoiceName(raw) {
  return raw.trim().toLowerCase();
}

// src/lib/config.ts
var DEFAULTS = {
  voiceEnabled: true,
  notificationsEnabled: true,
  messageMode: "local",
  voice: DEFAULT_VOICE
};
function loadConfig() {
  const env = process.env;
  const mode = env.CLAUDE_PLUGIN_OPTION_MESSAGEMODE;
  return {
    voiceEnabled: parseBoolean(
      env.CLAUDE_PLUGIN_OPTION_VOICEENABLED,
      DEFAULTS.voiceEnabled
    ),
    notificationsEnabled: parseBoolean(
      env.CLAUDE_PLUGIN_OPTION_NOTIFICATIONSENABLED,
      DEFAULTS.notificationsEnabled
    ),
    messageMode: mode === "llm" || mode === "local" ? mode : DEFAULTS.messageMode,
    voice: normalizeVoiceName(env.CLAUDE_PLUGIN_OPTION_VOICE ?? "") || DEFAULTS.voice,
    geminiApiKey: emptyToUndef(env.GEMINI_API_KEY)
  };
}
function parseBoolean(v, fallback) {
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}
function emptyToUndef(v) {
  return typeof v === "string" && v.trim() !== "" ? v : void 0;
}

// src/lib/hook-payload.ts
function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    const stdin = process.stdin;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve2(Buffer.concat(chunks).toString("utf8"));
    };
    stdin.on("data", (c) => chunks.push(c));
    stdin.on("end", done);
    stdin.on("error", done);
    stdin.on("close", done);
  });
}

// src/notifications/notification-hook.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { basename, resolve } from "node:path";

// src/notifications/dispatcher.ts
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/process.ts
import { spawn, spawnSync } from "node:child_process";
function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

// src/lib/rotating-log.ts
import { appendFileSync, renameSync, rmSync, statSync } from "node:fs";
function appendRotatingLog({ path, rotatedPath, maxBytes, rotatedMaxAgeMs }, message) {
  try {
    try {
      if (Date.now() - statSync(rotatedPath).mtimeMs > rotatedMaxAgeMs)
        rmSync(rotatedPath, { force: true });
    } catch {
    }
    if (statSync(path).size > maxBytes) renameSync(path, rotatedPath);
  } catch {
  }
  try {
    appendFileSync(
      path,
      `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`
    );
  } catch {
  }
}

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
var APP_DIR = "evolutivex-agents";
function stateDir() {
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const base = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
      return join(base, APP_DIR);
    }
    case "darwin":
      return join(home, "Library", "Application Support", APP_DIR);
    default: {
      const base = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");
      return join(base, APP_DIR);
    }
  }
}
function notificationLogPath() {
  return join(stateDir(), "notification.log");
}
function rotatedNotificationLogPath() {
  return join(stateDir(), "notification.log.1");
}

// src/notifications/delivery.ts
function appendNotificationLog(message) {
  appendRotatingLog(
    {
      path: notificationLogPath(),
      rotatedPath: rotatedNotificationLogPath(),
      maxBytes: 512 * 1024,
      rotatedMaxAgeMs: 14 * 24 * 60 * 60 * 1e3
    },
    message
  );
}
function serializeDeliveryRequest(request) {
  return JSON.stringify(request);
}

// src/notifications/dispatcher.ts
function deliverEntryPath() {
  return join2(
    dirname(fileURLToPath(import.meta.url)),
    "notification-deliver.js"
  );
}
var DetachedNotificationDispatcher = class {
  constructor(event, options = {}) {
    this.event = event;
    this.spawn = options.spawn ?? spawnDetached;
    this.log = options.log ?? appendNotificationLog;
  }
  spawn;
  log;
  notify(payload) {
    let pid;
    let reason = "sin PID";
    try {
      pid = this.spawn(process.execPath, [
        deliverEntryPath(),
        serializeDeliveryRequest({ event: this.event, payload })
      ]);
    } catch (err) {
      reason = err.message;
    }
    if (pid === void 0) {
      this.log(`event=${this.event} result=dispatch_failed error="${reason}"`);
    }
  }
};

// src/notifications/notification-payload.ts
import { existsSync as existsSync2 } from "node:fs";
import { join as join4 } from "node:path";

// src/notifications/event-notification-profile.ts
var NOTIFICATION_BRAND_TITLE = "EvolutiveX Agents";
var EVENT_NOTIFICATION_PROFILES = {
  UserPromptSubmit: {
    message: "Procesando tu solicitud...",
    image: "user-prompt-submit.png",
    level: "message",
    sound: { win32: "Reminder", darwin: "Submarine", linux: true }
  },
  PreToolUse: {
    message: "Pregunta pendiente \u2014 Responde en la ventana del cliente.",
    image: "pre-tool-use-ask.png",
    level: "attention",
    sound: { win32: "SMS", darwin: "Hero", linux: true }
  },
  SubagentStart: {
    message: "Subagente iniciado",
    image: "subagent-start.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true }
  },
  SubagentStop: {
    message: "Subagente terminado",
    image: "subagent-stop.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true }
  },
  Stop: {
    message: "Tu turno \u2014 El asistente termin\xF3. Escribe tu siguiente mensaje.",
    image: "stop.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true }
  },
  StopFailure: {
    message: "Error de API \u2014 No se complet\xF3 la respuesta.",
    image: "stop-failure.png",
    level: "alarm",
    sound: { win32: "LoopingAlarm7", darwin: "Basso", linux: true }
  },
  SessionStart: {
    message: "Sesi\xF3n iniciada",
    image: "session-start.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true }
  },
  SessionEnd: {
    message: "Sesi\xF3n finalizada",
    image: "session-end.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true }
  },
  PermissionRequest: {
    message: "Permiso requerido \u2014 Confirma la herramienta en el cliente.",
    image: "permission-request.png",
    level: "attention",
    sound: { win32: "SMS", darwin: "Hero", linux: true }
  },
  TaskCreated: {
    message: "Tarea creada",
    image: "task-created.png",
    level: "message",
    sound: { win32: "Reminder", darwin: "Submarine", linux: true }
  },
  TaskCompleted: {
    message: "Tarea completada",
    image: "task-completed.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true }
  },
  TaskInProgress: {
    message: "Tarea iniciada",
    image: "task-in-progress.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true }
  }
};
var NOTIFICATION_EVENT_KEYS = Object.keys(EVENT_NOTIFICATION_PROFILES);
function getProfileForEvent(eventKey) {
  return EVENT_NOTIFICATION_PROFILES[eventKey];
}

// src/notifications/event-image-paths.ts
import { existsSync } from "node:fs";
import { dirname as dirname2, join as join3, resolve as resolvePath } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function resolvePluginRoot(metaUrl = import.meta.url) {
  let dir = dirname2(fileURLToPath2(metaUrl));
  for (let i = 0; i < 4; i++) {
    if (existsSync(join3(dir, "assets", "notifications"))) {
      return dir;
    }
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolvePath(dirname2(fileURLToPath2(metaUrl)), "..");
}
var eventIconsDirProvider = {
  get() {
    return join3(resolvePluginRoot(), "assets", "notifications", "events");
  }
};
function getEventIconsDir() {
  return eventIconsDirProvider.get();
}
function resolveEventImagePath(filename) {
  const iconPath = join3(getEventIconsDir(), filename);
  return existsSync(iconPath) ? iconPath : void 0;
}

// src/notifications/hook-payload-notification-message.ts
var MAX_ASSISTANT_MESSAGE_LEN = 140;
var MAX_TOOL_INPUT_PREVIEW_LEN = 120;
var STOP_FAILURE_ERROR_MAP = {
  rate_limit: "L\xEDmite de tasa (API)",
  authentication_failed: "Error de autenticaci\xF3n",
  billing_error: "Error de facturaci\xF3n o cuota",
  invalid_request: "Solicitud inv\xE1lida",
  server_error: "Error del servidor",
  max_output_tokens: "L\xEDmite de tokens de salida",
  unknown: "Error de API desconocido"
};
var MOJIBAKE_SIGNATURE = /[Â-ß][\x80-¿]|[à-ï][\x80-¿]{2}/;
function repairMojibake(text) {
  if (!MOJIBAKE_SIGNATURE.test(text)) return text;
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  if (repaired.includes("\uFFFD")) return text;
  return repaired;
}
function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\u2026";
}
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}
function readStringField(payload, key) {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return void 0;
}
function formatStopFailureMessage(payload) {
  const err = readStringField(payload, "error") ?? "unknown";
  let line1 = STOP_FAILURE_ERROR_MAP[err];
  if (!line1) line1 = `Error de API (${err})`;
  const detail = readStringField(payload, "last_assistant_message");
  if (detail) {
    return `${line1}
${truncate(detail, MAX_ASSISTANT_MESSAGE_LEN)}`;
  }
  return line1;
}
function extractToolInputPreview(toolInput) {
  if (toolInput == null) return "";
  if (typeof toolInput === "string") {
    return toolInput;
  }
  if (typeof toolInput === "object") {
    const obj = toolInput;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.file_path === "string") return obj.file_path;
    try {
      return JSON.stringify(toolInput);
    } catch {
      return "";
    }
  }
  return "";
}
function formatPermissionRequestMessage(payload) {
  const tool = readStringField(payload, "tool_name") ?? "Herramienta";
  let preview = extractToolInputPreview(payload.tool_input);
  if (preview) {
    preview = truncate(
      normalizeWhitespace(preview),
      MAX_TOOL_INPUT_PREVIEW_LEN
    );
    return `Permiso para: ${tool}
${preview}`;
  }
  return `Permiso para: ${tool}`;
}
function formatPreToolUseAskMessage(payload) {
  const toolInput = payload.tool_input;
  if (toolInput == null || typeof toolInput !== "object") return null;
  const ti = toolInput;
  const questions = ti.questions;
  if (!questions?.length) return null;
  const n = questions.length;
  const line1 = n === 1 ? "1 pregunta pendiente" : `${n} preguntas pendientes`;
  const first = questions[0];
  let preview = "";
  if (first?.question?.trim()) {
    preview = first.question.trim();
  } else if (first?.header?.trim()) {
    preview = first.header.trim();
  }
  if (preview) {
    preview = truncate(
      normalizeWhitespace(preview),
      MAX_TOOL_INPUT_PREVIEW_LEN
    );
    return `${line1}
${preview}`;
  }
  return line1;
}
function formatUserPromptSubmitMessage(payload) {
  const prompt = readStringField(payload, "prompt");
  if (!prompt) return null;
  return truncate(normalizeWhitespace(prompt), MAX_TOOL_INPUT_PREVIEW_LEN);
}
function formatStopMessage(payload) {
  const detail = readStringField(payload, "last_assistant_message");
  if (!detail) return null;
  return truncate(detail, MAX_ASSISTANT_MESSAGE_LEN);
}
function formatTaskInProgressMessage(payload) {
  const toolInput = payload.tool_input;
  const subject = toolInput != null && typeof toolInput === "object" ? readStringField(toolInput, "subject") : void 0;
  if (!subject) return null;
  return `Tarea iniciada: ${truncate(normalizeWhitespace(subject), MAX_TOOL_INPUT_PREVIEW_LEN)}`;
}
function formatTaskMessage(payload, prefix) {
  const subject = readStringField(payload, "task_subject");
  return subject ? `${prefix}: ${truncate(normalizeWhitespace(subject), MAX_TOOL_INPUT_PREVIEW_LEN)}` : null;
}
var HOOK_PAYLOAD_MESSAGE_FORMATTERS = {
  StopFailure: formatStopFailureMessage,
  PermissionRequest: formatPermissionRequestMessage,
  PreToolUse: formatPreToolUseAskMessage,
  UserPromptSubmit: formatUserPromptSubmitMessage,
  Stop: formatStopMessage,
  TaskInProgress: formatTaskInProgressMessage,
  TaskCreated: (payload) => formatTaskMessage(payload, "Tarea creada"),
  TaskCompleted: (payload) => formatTaskMessage(payload, "Tarea completada")
};
function resolveHookNotificationMessage(eventKey, payload) {
  const formatter = HOOK_PAYLOAD_MESSAGE_FORMATTERS[eventKey];
  if (!formatter) return null;
  const result = formatter(payload);
  if (result == null || result.trim() === "") return null;
  return repairMojibake(result);
}

// src/notifications/resolve-notification-sound.ts
var WIN32_NOTIFICATION_SOUND = {
  Default: "Notification.Default",
  IM: "Notification.IM",
  Reminder: "Notification.Reminder",
  SMS: "Notification.SMS",
  LoopingAlarm7: "Notification.Looping.Alarm7"
};
function toWin32NotificationSound(token) {
  if (token.startsWith("Notification.")) {
    return token;
  }
  return WIN32_NOTIFICATION_SOUND[token] ?? "Notification.Default";
}
function resolveNotificationSound(profile, platform2) {
  if (!profile) {
    return false;
  }
  if (platform2 === "win32") {
    const token = profile.win32;
    if (token === false || token === void 0) {
      return false;
    }
    return toWin32NotificationSound(token);
  }
  if (platform2 === "darwin") {
    const name = profile.darwin;
    if (name === false || name === void 0) {
      return false;
    }
    return name;
  }
  if (platform2 === "linux") {
    return profile.linux === true;
  }
  return false;
}

// src/notifications/notification-payload.ts
var DEFAULT_APP_ID = "EvolutiveX.Agents";
var globalFallbackIconProvider = {
  get() {
    return join4(
      resolvePluginRoot(),
      "assets",
      "notifications",
      "ai-assistant.png"
    );
  }
};
function resolveGlobalFallbackIconPath() {
  const p = globalFallbackIconProvider.get();
  return existsSync2(p) ? p : void 0;
}
function normalizeStdinJsonText(raw) {
  return raw.replace(/^\uFEFF/, "").trim();
}
function resolveEventKey(options, stdinPayload) {
  if (options.eventType) {
    return options.eventType;
  }
  if (options.stdinJson && stdinPayload) {
    const name = stdinPayload["hook_event_name"];
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }
  return void 0;
}
function resolveBranding(options, eventKey) {
  const appId = options.appId ?? DEFAULT_APP_ID;
  if (options.icon !== void 0) {
    return { appId, icon: options.icon };
  }
  const key = eventKey ?? options.eventType;
  if (key) {
    const profile = getProfileForEvent(key);
    if (profile) {
      const eventIcon = resolveEventImagePath(profile.image);
      if (eventIcon) {
        return { appId, icon: eventIcon };
      }
    }
  }
  const fallback = resolveGlobalFallbackIconPath();
  if (fallback) {
    return { appId, icon: fallback };
  }
  return { appId };
}
function resolveEventSound(options, eventKey, platform2 = process.platform) {
  if (options.silent) {
    return false;
  }
  if (options.sound) {
    return true;
  }
  const profile = eventKey ? getProfileForEvent(eventKey) : void 0;
  return resolveNotificationSound(profile?.sound, platform2);
}
function resolveNotificationTitle(options, eventKey) {
  if (options.title !== void 0 && options.title !== "") {
    return options.title;
  }
  if (eventKey) {
    return eventKey;
  }
  return NOTIFICATION_BRAND_TITLE;
}
function resolveNotificationMessage(options, eventKey, stdinPayload) {
  if (options.message !== void 0 && options.message !== "") {
    return options.message;
  }
  if (options.stdinJson && stdinPayload && eventKey) {
    const dynamic = resolveHookNotificationMessage(eventKey, stdinPayload);
    if (dynamic) return dynamic;
  }
  if (eventKey) {
    return getProfileForEvent(eventKey)?.message;
  }
  return void 0;
}
function buildNotificationPayload(options, stdinPayload, platform2 = process.platform) {
  if (options.stdinJson && !stdinPayload) {
    return { error: "No se recibi\xF3 payload por stdin con --stdin-json" };
  }
  const eventKey = resolveEventKey(options, stdinPayload);
  if (!options.stdinJson && !options.eventType) {
    return { error: "Falta --event-type (o usa --stdin-json con payload)" };
  }
  const title = resolveNotificationTitle(options, eventKey);
  const message = resolveNotificationMessage(options, eventKey, stdinPayload);
  if (message === void 0 || message === "") {
    return {
      error: "Falta mensaje: usa --message, --event-type con perfil en cat\xE1logo, o --stdin-json con formatter aplicable"
    };
  }
  const branding = resolveBranding(options, eventKey);
  return {
    title,
    message,
    sound: resolveEventSound(options, eventKey, platform2),
    silent: options.silent,
    appId: branding.appId,
    ...branding.icon !== void 0 ? { icon: branding.icon } : {}
  };
}

// src/notifications/notification-hook.ts
var DIRECT_NOTIFICATION_EVENTS = /* @__PURE__ */ new Set([
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionStart",
  "SessionEnd",
  "PermissionRequest",
  "TaskCreated",
  "TaskCompleted"
]);
function notificationEventKey(payload) {
  const event = payload.hook_event_name;
  if (event === "PreToolUse") {
    return payload.tool_name === "AskUserQuestion" ? event : void 0;
  }
  if (event === "PostToolUse") {
    const input = payload.tool_input;
    return payload.tool_name === "TaskUpdate" && input !== null && typeof input === "object" && input.status === "in_progress" ? "TaskInProgress" : void 0;
  }
  return typeof event === "string" && DIRECT_NOTIFICATION_EVENTS.has(event) ? event : void 0;
}
async function runNotificationHookFromRaw(raw, service) {
  if (!loadConfig().notificationsEnabled) return false;
  const normalized = normalizeStdinJsonText(raw);
  if (!normalized) return false;
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const payload = parsed;
  const event = notificationEventKey(payload);
  if (!event) return false;
  if (event === "PreToolUse") {
    const ti = payload.tool_input;
    const questions = ti != null && typeof ti === "object" ? ti.questions : void 0;
    if (!Array.isArray(questions) || questions.length === 0) {
      return false;
    }
  }
  const built = buildNotificationPayload(
    {
      eventType: event,
      sound: false,
      silent: true,
      stdinJson: true
    },
    payload
  );
  if ("error" in built) return false;
  await (service ?? new DetachedNotificationDispatcher(event)).notify(built);
  return true;
}
async function main() {
  const raw = await readStdin();
  await runNotificationHookFromRaw(raw);
}
if (process.argv[1] && ["notification-hook.js", "notification-hook.ts"].includes(
  basename(process.argv[1])
) && fileURLToPath3(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
  }).finally(() => process.exit(0));
}
export {
  notificationEventKey,
  runNotificationHookFromRaw
};
