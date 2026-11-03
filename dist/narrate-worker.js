// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/voice/narrate-worker.ts
import {
  appendFileSync,
  readFileSync as readFileSync2,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync3,
  writeFileSync as writeFileSync2
} from "node:fs";

// src/lib/config.ts
var DEFAULTS = {
  voiceEnabled: true,
  notificationsEnabled: true,
  messageMode: "local"
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
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
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
      if (depth === 0) {
        if (trimmed.slice(i + 1).trim() !== "") return void 0;
        try {
          return JSON.parse(trimmed.slice(0, i + 1));
        } catch {
          return void 0;
        }
      }
    }
  }
  return void 0;
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

// src/voice/queue.ts
import {
  mkdirSync as mkdirSync2,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join as join2 } from "node:path";

// src/lib/hook-payload.ts
function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  return {};
}

// src/voice/queue.ts
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
  const pending = listPending();
  if (pending.length === 0) return void 0;
  const file = join2(queueDir(), pending[0]);
  let payload;
  try {
    payload = parsePayload(readFileSync(file, "utf8"));
  } catch {
    payload = {};
  }
  try {
    rmSync(file, { force: true });
  } catch {
  }
  return { file, payload };
}
function pruneQueue(options) {
  const max = options.max ?? MAX_PENDING;
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
  const pending = listPending();
  const now = Date.now();
  for (const name of pending) {
    const file = join2(queueDir(), name);
    try {
      const mt = statSync(file).mtimeMs;
      if (now - mt >= maxAgeMs) {
        rmSync(file, { force: true });
      }
    } catch {
    }
  }
  const remaining = listPending();
  const excess = remaining.length - max;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) {
      try {
        rmSync(join2(queueDir(), remaining[i]), { force: true });
      } catch {
      }
    }
  }
}
function clearQueue() {
  try {
    for (const name of listPending()) {
      rmSync(join2(queueDir(), name), { force: true });
    }
  } catch {
  }
}

// src/voice/resolve-cli.ts
import {
  spawn as spawn2,
  spawnSync as spawnSync2
} from "node:child_process";
import { existsSync, statSync as statSync2 } from "node:fs";
import { delimiter, join as join3 } from "node:path";

// src/voice/spawn.ts
import { spawn, spawnSync } from "node:child_process";
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
        if (existsSync(full) && statSync2(full).isFile()) return full;
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
var SUMMARY_SYSTEM_PROMPT = "Eres un desarrollador que habla por voz sintetizada en tiempo real. Narra en primera persona, en una o dos frases breves en espa\xF1ol, \xFAnicamente lo que muestra el material de este turno. Si el turno fue una conversaci\xF3n breve, un saludo o una respuesta sin cambios t\xE9cnicos, n\xE1rralo con naturalidad como tal. No inventes trabajo, comandos, rutas ni identificadores que no aparezcan expl\xEDcitos. Conserva los identificadores y rutas que s\xED est\xE9n presentes cuando aporten claridad. Texto plano, sin markdown ni s\xEDmbolos.";
var SUMMARY_CLOSING = "Cu\xE9ntamelo en voz alta en primera persona, de forma fiel a lo que ocurri\xF3 en este turno.";

// src/voice/message/provider.ts
var REQUEST_TIMEOUT_MS = 8e3;
var MAX_OUTPUT_TOKENS = 512;
function buildUserContent(input) {
  const text = (input.text ?? "").trim();
  return `Material del turno:

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

// src/voice/narrate-worker.ts
var WORKER_LOG_MAX_BYTES = 512 * 1024;
var WORKER_LOG_ROTATED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1e3;
function rotateWorkerLog() {
  try {
    const rotated = rotatedWorkerLogPath();
    try {
      if (Date.now() - statSync3(rotated).mtimeMs > WORKER_LOG_ROTATED_MAX_AGE_MS)
        rmSync2(rotated, { force: true });
    } catch {
    }
    if (statSync3(workerLogPath()).size > WORKER_LOG_MAX_BYTES)
      renameSync2(workerLogPath(), rotated);
  } catch {
  }
}
function log(msg) {
  rotateWorkerLog();
  try {
    appendFileSync(workerLogPath(), `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
  } catch {
  }
}
var PLAY_TIMEOUT_MS = 1e4;
var KILL_GRACE_MS = 2e3;
var REASON_HINTS = {
  speech_not_found: "locuci\xF3n no pre-sintetizada; ejecuta narrate-ctl presynth",
  voice_not_found: "voz no encontrada en el motor; ejecuta ai-voice-interconnector setup y luego narrate-ctl presynth",
  no_output_device: "sin dispositivo de salida de audio predeterminado; revisa ai-voice-interconnector devices",
  audio_backend_unavailable: "backend de audio del sistema no disponible (en Linux, ALSA/libasound.so.2)",
  playback_failed: "fallo de reproducci\xF3n del audio",
  daemon_unreachable: "daemon ca\xEDdo; SessionStart lo levanta o ejecuta ai-voice-interconnector daemon start",
  model_missing: "modelo no provisionado; ejecuta ai-voice-interconnector setup"
};
function failureDetail(stdout) {
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return "";
  const reason = payload.reason;
  if (typeof reason !== "string" || !Object.hasOwn(REASON_HINTS, reason)) {
    return "";
  }
  return ` (${reason}: ${REASON_HINTS[reason]})`;
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
    writeFileSync2(pidPath, String(process.pid), {
      encoding: "utf8",
      flag: "wx"
    });
    return true;
  } catch {
    try {
      const owner = Number.parseInt(readFileSync2(pidPath, "utf8").trim(), 10);
      if (Number.isInteger(owner) && isAlive(owner)) return false;
      rmSync2(pidPath, { force: true });
      writeFileSync2(pidPath, String(process.pid), {
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
      readFileSync2(workerPidPath(), "utf8").trim(),
      10
    );
    if (owner === process.pid) rmSync2(workerPidPath(), { force: true });
  } catch {
  }
}
async function runPlay(cliPath, label) {
  const args = ["speech", "play", "--label", label, "--json"];
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs: PLAY_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS
  });
  if (res.timedOut) {
    log(`speech play timeout tras ${PLAY_TIMEOUT_MS} ms; proceso terminado`);
    return;
  }
  if (res.code !== 0)
    log(`speech play sali\xF3 con c\xF3digo ${res.code}${failureDetail(res.stdout)}`);
}
async function runSay(cliPath, text) {
  const args = ["speech", "say", "--text", text, "--daemon", "--json"];
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
    return;
  }
  if (res.code !== 0)
    log(`speech say sali\xF3 con c\xF3digo ${res.code}${failureDetail(res.stdout)}`);
}
async function main() {
  ensureStateDir();
  if (!acquireLock()) return;
  try {
    pruneQueue({ max: 64, maxAgeMs: 60 * 60 * 1e3 });
    let lastActivity = Date.now();
    while (true) {
      const item = claimNext();
      if (!item) {
        if (Date.now() - lastActivity > IDLE_MS) break;
        sleepSync(IDLE_POLL_MS);
        continue;
      }
      lastActivity = Date.now();
      const cfg = loadConfig();
      if (!cfg.voiceEnabled) {
        clearQueue();
        return;
      }
      const request = await buildMessage(item.payload, cfg);
      if (request.kind === "say" && !request.text) {
        log("mensaje vac\xEDo tras la construcci\xF3n; nada que narrar");
        continue;
      }
      const cli = resolveCli();
      if (!cli) {
        log(
          "ai-voice-interconnector no encontrado en PATH; se omite la narraci\xF3n"
        );
        continue;
      }
      if (request.kind === "play") await runPlay(cli, request.label);
      else await runSay(cli, request.text);
      if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);
    }
  } finally {
    releaseLock();
    process.exit(0);
  }
}
main().catch((err) => {
  log(`worker error: ${err?.message ?? err}`);
  process.exit(0);
});
