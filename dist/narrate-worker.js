// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/voice/narrate-worker.ts
import { readFileSync as readFileSync3, rmSync as rmSync4, writeFileSync as writeFileSync3 } from "node:fs";

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

// src/voice/health-decision.ts
function parseSingleJsonObject(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return void 0;
  const end = objectEnd(trimmed);
  if (end < 0 || trimmed.slice(end + 1).trim() !== "") return void 0;
  try {
    return JSON.parse(trimmed.slice(0, end + 1));
  } catch {
    return void 0;
  }
}
function objectEnd(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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
function ensureStateDir() {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
function workerPidPath() {
  return join(stateDir(), "worker.pid");
}
function queueDir() {
  return join(stateDir(), "queue");
}
function workerLogPath() {
  return join(stateDir(), "worker.log");
}
function rotatedWorkerLogPath() {
  return join(stateDir(), "worker.log.1");
}
function notificationLogPath() {
  return join(stateDir(), "notification.log");
}
function rotatedNotificationLogPath() {
  return join(stateDir(), "notification.log.1");
}
function voiceProblemPath() {
  return join(stateDir(), "voice-problem.json");
}

// src/voice/queue.ts
import {
  mkdirSync as mkdirSync2,
  readFileSync,
  readdirSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync2,
  writeFileSync
} from "node:fs";
import { join as join2 } from "node:path";
var MAX_PENDING = 64;
var MAX_AGE_MS = 60 * 60 * 1e3;
function listPending() {
  const dir = queueDir();
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".tmp-")).sort();
  } catch {
    return [];
  }
}
function claimNext() {
  for (const name of listPending()) {
    const file = join2(queueDir(), name);
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      raw = void 0;
    }
    try {
      rmSync2(file, { force: true });
    } catch {
    }
    const item = raw === void 0 ? void 0 : parseQueueItem(raw);
    if (item) return { file, ...item };
  }
  return void 0;
}
function parseQueueItem(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (!isRecord(parsed)) return void 0;
  const { payload, voice } = parsed;
  if (!isRecord(payload) || typeof voice !== "string" || voice === "")
    return void 0;
  return { payload, voice };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pruneQueue(options) {
  const max = options.max ?? MAX_PENDING;
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
  const pending = listPending();
  const now = Date.now();
  for (const name of pending) {
    const file = join2(queueDir(), name);
    try {
      const mt = statSync2(file).mtimeMs;
      if (now - mt >= maxAgeMs) {
        rmSync2(file, { force: true });
      }
    } catch {
    }
  }
  const remaining = listPending();
  const excess = remaining.length - max;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) {
      try {
        rmSync2(join2(queueDir(), remaining[i]), { force: true });
      } catch {
      }
    }
  }
}
function clearQueue() {
  try {
    for (const name of listPending()) {
      rmSync2(join2(queueDir(), name), { force: true });
    }
  } catch {
  }
}

// src/voice/resolve-cli.ts
import {
  spawn as spawn2,
  spawnSync as spawnSync2
} from "node:child_process";
import { existsSync, statSync as statSync3 } from "node:fs";
import { delimiter, join as join3 } from "node:path";

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
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function killProcessTree(pid, opts = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const graceMs = opts.killGraceMs ?? 2e3;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
  }
  if (graceMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, graceMs);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
  }
}

// src/voice/resolve-cli.ts
var BASE = "ai-voice-interconnector";
function candidateNames() {
  if (process.platform !== "win32") return [BASE];
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.trim()).filter(Boolean);
  return [...exts.map((e) => BASE + e.toLowerCase()), BASE];
}
function resolveCli() {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = candidateNames();
  for (const dir of dirs) {
    for (const name of names) {
      const full = join3(dir, name);
      try {
        if (existsSync(full) && statSync3(full).isFile()) return full;
      } catch {
      }
    }
  }
  return void 0;
}
function needsShell(cliPath) {
  if (process.platform !== "win32") return false;
  const lower = cliPath.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}
function quoteForCmd(token) {
  return /[\s"&|<>^%]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}
function buildShellCommand(cli, args) {
  return [cli, ...args].map(quoteForCmd).join(" ");
}
function spawnCli(cli, args, opts) {
  return needsShell(cli) ? spawn2(buildShellCommand(cli, args), { ...opts, shell: true }) : spawn2(cli, args, { ...opts, shell: false });
}
var MAX_STDOUT_BYTES = 64 * 1024;
function runCliWithTimeout(cli, args, opts) {
  const { timeoutMs, killGraceMs = 2e3, ...spawnOpts } = opts;
  const child = spawnCli(cli, args, {
    ...spawnOpts,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  const chunks = [];
  let captured = 0;
  child.stdout?.on("data", (chunk) => {
    if (captured >= MAX_STDOUT_BYTES) return;
    const slice = chunk.subarray(0, MAX_STDOUT_BYTES - captured);
    chunks.push(slice);
    captured += slice.length;
  });
  let resolved = false;
  let timer;
  return new Promise((resolve) => {
    const finish = (code, signal, timedOut, error) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        stdout: Buffer.concat(chunks).toString("utf8"),
        error
      });
    };
    timer = setTimeout(() => {
      killProcessTree(child.pid ?? 0, { killGraceMs });
      finish(codeOrNull(child), "SIGKILL", true);
    }, timeoutMs);
    child.on("error", (err) => {
      finish(null, null, false, err);
    });
    child.on("close", (code, signal) => {
      finish(code, signal, false);
    });
  });
}
function codeOrNull(child) {
  return typeof child.exitCode === "number" ? child.exitCode : null;
}

// src/voice/message/prompts.ts
var SUMMARY_SYSTEM_PROMPT = 'Eres la voz del asistente. Di en voz alta, en una o dos frases breves en espa\xF1ol, una versi\xF3n condensada de su mensaje, como si t\xFA mismo se lo estuvieras diciendo al usuario. Parafrasea el mensaje; no lo describas ni lo relates desde fuera: di "Hola, \xBFqu\xE9 tal?" y no "Te he saludado y te he preguntado qu\xE9 tal". Mant\xE9n la persona, el tono y la intenci\xF3n del original: si pregunta, pregunta; si informa, informa. No inventes trabajo, comandos, rutas ni identificadores que no aparezcan expl\xEDcitos. Conserva los identificadores y rutas presentes cuando aporten claridad. Texto plano, sin markdown ni s\xEDmbolos.';
var SUMMARY_CLOSING = "Dilo en voz alta, parafraseado y condensado, como si fuera tu propio mensaje.";

// src/voice/message/provider.ts
var REQUEST_TIMEOUT_MS = 8e3;
var MAX_OUTPUT_TOKENS = 512;
function buildUserContent(input) {
  const text = (input.text ?? "").trim();
  return `Mensaje del asistente:

${text}

${SUMMARY_CLOSING}`;
}

// src/voice/message/gemini-provider.ts
var MODEL = "gemini-3.1-flash-lite";
var buildEndpointUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
var GeminiProvider = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  name = "gemini";
  async generate(input) {
    if (!this.apiKey) throw new Error("Gemini: sin API key");
    const content = buildUserContent(input);
    const body = {
      systemInstruction: {
        parts: [{ text: SUMMARY_SYSTEM_PROMPT }]
      },
      contents: [{ role: "user", parts: [{ text: content }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    const res = await fetch(buildEndpointUrl(MODEL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini devolvi\xF3 respuesta vac\xEDa");
    return text;
  }
};

// src/voice/message/static-announcements.ts
function announcement(text, label) {
  return { text, label };
}
var ANNOUNCEMENTS = {
  UserPromptSubmit: announcement(
    "Procesando con Claude.",
    "voice-user-prompt-submit"
  ),
  Stop: announcement("El asistente termin\xF3 su turno.", "voice-stop"),
  SubagentStop: announcement(
    "El subagente complet\xF3 su trabajo.",
    "voice-subagent-stop"
  ),
  StopFailure: announcement(
    "Ocurri\xF3 un error durante la ejecuci\xF3n.",
    "voice-stop-failure"
  ),
  Notification: announcement(
    "Claude necesita tu atenci\xF3n.",
    "voice-notification"
  ),
  Default: announcement("Notificaci\xF3n de Claude.", "voice-default")
};

// src/voice/message/sanitize.ts
function toPlainText(input) {
  let t = input ?? "";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " ");
  t = t.replace(/```[\s\S]*$/g, " ");
  t = t.replace(/~~~[\s\S]*$/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, "");
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, "");
  t = t.replace(/[*_~]{1,3}/g, "");
  t = t.replace(/[^\p{L}\p{N}\s.,;:¿?¡!()'"-]/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function sanitizeForSpeech(input) {
  return toPlainText(input);
}

// src/voice/message/clamp.ts
var LLM_INPUT_MAX_CHARS = 16e3;
var SPEECH_MAX_SENTENCES = 2;
var SPEECH_MAX_CHARS = 500;
var SENTENCE_TERMINATORS = /* @__PURE__ */ new Set([".", "!", "?", "\u2026"]);
function clampHead(text) {
  const t = text ?? "";
  if (t.length <= LLM_INPUT_MAX_CHARS) return t;
  const window = t.slice(0, LLM_INPUT_MAX_CHARS);
  const lastPara = window.lastIndexOf("\n\n");
  if (lastPara > 0) return window.slice(0, lastPara).trimEnd();
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  return window;
}
function clampSentences(text, maxChars, maxSentences) {
  const t = (text ?? "").trim();
  if (!t) return "";
  const sentences = splitSentences(t);
  if (t.length <= maxChars && sentences.length <= maxSentences) return t;
  let acc = "";
  let count = 0;
  for (const sentence of sentences) {
    if (count >= maxSentences) break;
    const next = acc ? `${acc} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    acc = next;
    count++;
  }
  if (acc) return acc;
  const window = t.slice(0, maxChars);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  return window;
}
function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_TERMINATORS.has(text[i])) {
      if (text[i] === "." && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
        continue;
      }
      let end = i + 1;
      while (end < text.length && SENTENCE_TERMINATORS.has(text[end])) end++;
      const sentence = text.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      i = end - 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
function isDigit(char) {
  return char !== void 0 && char >= "0" && char <= "9";
}

// src/voice/message/build-message.ts
async function buildMessage(payload, cfg) {
  const event = payload.hook_event_name;
  if (event === "Notification") {
    return { kind: "play", label: ANNOUNCEMENTS.Notification.label };
  }
  if (event === "UserPromptSubmit") {
    return { kind: "play", label: ANNOUNCEMENTS.UserPromptSubmit.label };
  }
  if (event === "SubagentStop") {
    return { kind: "play", label: ANNOUNCEMENTS.SubagentStop.label };
  }
  if (event === "StopFailure") {
    return { kind: "play", label: ANNOUNCEMENTS.StopFailure.label };
  }
  const raw = payload.last_assistant_message ?? "";
  const primary = sanitizeForSpeech(raw);
  if (primary === "") {
    const fallback = event === "Stop" ? ANNOUNCEMENTS.Stop : ANNOUNCEMENTS.Default;
    return { kind: "play", label: fallback.label };
  }
  if (cfg.messageMode === "llm" && cfg.geminiApiKey) {
    try {
      const input = { text: clampHead(raw) };
      const llm = (await new GeminiProvider(cfg.geminiApiKey).generate(input)).trim();
      const clean = sanitizeForSpeech(llm);
      if (clean)
        return {
          kind: "say",
          text: clampSentences(clean, SPEECH_MAX_CHARS, SPEECH_MAX_SENTENCES)
        };
    } catch {
    }
  }
  return {
    kind: "say",
    text: clampSentences(primary, SPEECH_MAX_CHARS, SPEECH_MAX_SENTENCES)
  };
}

// src/voice/say-timeout.ts
var SAY_BASE_MS = 3e4;
var SAY_PER_CHAR_MS = 400;
function sayTimeoutMs(text) {
  return SAY_BASE_MS + text.length * SAY_PER_CHAR_MS;
}

// src/voice/voice.ts
var FACTORY_VOICES = ["default", "ryan", "vivian"];
var CUSTOM_VOICE = "custom";
var SELECTABLE_VOICES = [
  ...FACTORY_VOICES,
  CUSTOM_VOICE
];

// src/notifications/dispatcher.ts
import { dirname, join as join4 } from "node:path";
import { fileURLToPath } from "node:url";

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
  return join4(
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

// src/notifications/notification-payload.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join6 } from "node:path";

// src/notifications/event-image-paths.ts
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, join as join5, resolve as resolvePath } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function resolvePluginRoot(metaUrl = import.meta.url) {
  let dir = dirname2(fileURLToPath2(metaUrl));
  for (let i = 0; i < 4; i++) {
    if (existsSync2(join5(dir, "assets", "notifications"))) {
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
    return join5(resolvePluginRoot(), "assets", "notifications", "events");
  }
};
function getEventIconsDir() {
  return eventIconsDirProvider.get();
}
function resolveEventImagePath(filename) {
  const iconPath = join5(getEventIconsDir(), filename);
  return existsSync2(iconPath) ? iconPath : void 0;
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
    return join6(
      resolvePluginRoot(),
      "assets",
      "notifications",
      "ai-assistant.png"
    );
  }
};
function resolveGlobalFallbackIconPath() {
  const p = globalFallbackIconProvider.get();
  return existsSync3(p) ? p : void 0;
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

// src/voice/voice-problem.ts
import { readFileSync as readFileSync2, renameSync as renameSync3, rmSync as rmSync3, writeFileSync as writeFileSync2 } from "node:fs";
var NOTIFIABLE_REASONS = [
  "voice_not_found",
  "speech_not_found",
  "invalid_voice_name"
];
function readProblem() {
  try {
    const data = JSON.parse(readFileSync2(voiceProblemPath(), "utf8"));
    if (typeof data !== "object" || data === null) return void 0;
    const { voice, reason } = data;
    if (typeof voice !== "string" || typeof reason !== "string")
      return void 0;
    return { voice, reason };
  } catch {
    return void 0;
  }
}
function writeProblem(problem) {
  ensureStateDir();
  const path = voiceProblemPath();
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync2(tmpPath, `${JSON.stringify(problem)}
`, "utf8");
  renameSync3(tmpPath, path);
}
function trackVoiceProblem(voice, outcome) {
  try {
    if (outcome.ok) {
      rmSync3(voiceProblemPath(), { force: true });
      return false;
    }
    const { reason } = outcome;
    if (reason === void 0 || !NOTIFIABLE_REASONS.includes(reason))
      return false;
    const last = readProblem();
    if (last?.voice === voice && last.reason === reason) return false;
    writeProblem({ voice, reason });
    return true;
  } catch {
    return false;
  }
}

// src/voice/narrate-worker.ts
function log(msg) {
  appendRotatingLog(
    {
      path: workerLogPath(),
      rotatedPath: rotatedWorkerLogPath(),
      maxBytes: 512 * 1024,
      rotatedMaxAgeMs: 14 * 24 * 60 * 60 * 1e3
    },
    msg
  );
}
var PLAY_TIMEOUT_MS = 1e4;
var KILL_GRACE_MS = 2e3;
var REASON_HINTS = {
  speech_not_found: (voice) => `locuci\xF3n no pre-sintetizada para la voz ${voice}; ejecuta narrate-ctl presynth --voice ${voice}`,
  voice_not_found: (voice) => voice === CUSTOM_VOICE ? "la voz custom todav\xEDa no est\xE1 clonada; cl\xF3nala con /evolutivex-agents:voice clone o elige otra en /config \u2192 evolutivex-agents.voice" : `la voz ${voice} no existe en el motor; elige otra en /config \u2192 evolutivex-agents.voice`,
  // `speech play` responde así a un nombre de voz ilegal (las etiquetas del
  // catálogo son fijas y válidas), p. ej. un valor antiguo en settings.json.
  invalid_voice_name: (voice) => `el nombre de voz \xAB${voice}\xBB no es v\xE1lido; elige una voz en /config \u2192 evolutivex-agents.voice`,
  no_output_device: "sin dispositivo de salida de audio predeterminado; revisa ai-voice-interconnector devices",
  audio_backend_unavailable: "backend de audio del sistema no disponible (en Linux, ALSA/libasound.so.2)",
  playback_failed: "fallo de reproducci\xF3n del audio",
  daemon_unreachable: "daemon ca\xEDdo; SessionStart lo levanta o ejecuta ai-voice-interconnector daemon start",
  model_missing: "modelo no provisionado; ejecuta ai-voice-interconnector setup"
};
function reasonHint(reason, voice) {
  if (!Object.hasOwn(REASON_HINTS, reason)) return void 0;
  const hint = REASON_HINTS[reason];
  return typeof hint === "function" ? hint(voice) : hint;
}
function failureReason(stdout) {
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return void 0;
  const reason = payload.reason;
  return typeof reason === "string" ? reason : void 0;
}
function failureDetail(reason, voice) {
  const hint = reason === void 0 ? void 0 : reasonHint(reason, voice);
  return hint === void 0 ? "" : ` (${reason}: ${hint})`;
}
function notifyVoiceProblem(hint) {
  const built = buildNotificationPayload({
    eventType: "VoiceProblem",
    title: NOTIFICATION_BRAND_TITLE,
    message: hint.charAt(0).toUpperCase() + hint.slice(1),
    sound: false,
    silent: true,
    stdinJson: false
  });
  if ("error" in built) {
    log(`aviso de voz no construido: ${built.error}`);
    return;
  }
  new DetachedNotificationDispatcher("VoiceProblem").notify(built);
}
var NARRATION_GAP_MS = 1e3;
var IDLE_MS = 5e3;
var IDLE_POLL_MS = 100;
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function acquireLock() {
  const pidPath = workerPidPath();
  try {
    writeFileSync3(pidPath, String(process.pid), {
      encoding: "utf8",
      flag: "wx"
    });
    return true;
  } catch {
    try {
      const owner = Number.parseInt(readFileSync3(pidPath, "utf8").trim(), 10);
      if (Number.isInteger(owner) && isAlive(owner)) return false;
      rmSync4(pidPath, { force: true });
      writeFileSync3(pidPath, String(process.pid), {
        encoding: "utf8",
        flag: "wx"
      });
      return true;
    } catch {
      return false;
    }
  }
}
function releaseLock() {
  try {
    const owner = Number.parseInt(
      readFileSync3(workerPidPath(), "utf8").trim(),
      10
    );
    if (owner === process.pid) rmSync4(workerPidPath(), { force: true });
  } catch {
  }
}
async function runPlay(cliPath, label, voice) {
  const args = ["speech", "play", "--label", label, "--voice", voice, "--json"];
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs: PLAY_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS
  });
  if (res.timedOut) {
    log(`speech play timeout tras ${PLAY_TIMEOUT_MS} ms; proceso terminado`);
    return { ok: false };
  }
  if (res.code === 0) return { ok: true };
  const reason = failureReason(res.stdout);
  log(
    `speech play sali\xF3 con c\xF3digo ${res.code}${failureDetail(reason, voice)}`
  );
  return { ok: false, reason };
}
async function runSay(cliPath, text, voice) {
  const args = [
    "speech",
    "say",
    "--text",
    text,
    "--voice",
    voice,
    "--daemon",
    "--json"
  ];
  const timeoutMs = sayTimeoutMs(text);
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs,
    killGraceMs: KILL_GRACE_MS
  });
  if (res.timedOut) {
    log(
      `speech say timeout tras ${timeoutMs} ms (${text.length} caracteres); proceso terminado`
    );
    return { ok: false };
  }
  if (res.code === 0) return { ok: true };
  const reason = failureReason(res.stdout);
  log(`speech say sali\xF3 con c\xF3digo ${res.code}${failureDetail(reason, voice)}`);
  return { ok: false, reason };
}
async function narrate({ payload, voice }) {
  const cfg = loadConfig();
  if (!cfg.voiceEnabled) {
    clearQueue();
    return false;
  }
  const request = await buildMessage(payload, cfg);
  if (request.kind === "say" && !request.text) {
    log("mensaje vac\xEDo tras la construcci\xF3n; nada que narrar");
    return true;
  }
  const cli = resolveCli();
  if (!cli) {
    log("ai-voice-interconnector no encontrado en PATH; se omite la narraci\xF3n");
    return true;
  }
  const outcome = request.kind === "play" ? await runPlay(cli, request.label, voice) : await runSay(cli, request.text, voice);
  const isNewProblem = trackVoiceProblem(voice, outcome);
  if (isNewProblem && cfg.notificationsEnabled && !outcome.ok) {
    const hint = reasonHint(outcome.reason ?? "", voice);
    if (hint !== void 0) notifyVoiceProblem(hint);
  }
  if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);
  return true;
}
async function drainQueue() {
  let lastActivity = Date.now();
  while (true) {
    const item = claimNext();
    if (!item) {
      if (Date.now() - lastActivity > IDLE_MS) return;
      sleepSync(IDLE_POLL_MS);
      continue;
    }
    lastActivity = Date.now();
    if (!await narrate(item)) return;
  }
}
async function main() {
  ensureStateDir();
  if (!acquireLock()) return;
  try {
    pruneQueue({ max: 64, maxAgeMs: 60 * 60 * 1e3 });
    await drainQueue();
  } finally {
    releaseLock();
    process.exit(0);
  }
}
main().catch((err) => {
  log(`worker error: ${err?.message ?? err}`);
  process.exit(0);
});
