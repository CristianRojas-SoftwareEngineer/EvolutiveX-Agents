// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/voice/voice.ts
var DEFAULT_VOICE = "default";
var FACTORY_VOICES = ["default", "ryan", "vivian"];
var CUSTOM_VOICE = "custom";
var SELECTABLE_VOICES = [
  ...FACTORY_VOICES,
  CUSTOM_VOICE
];
function normalizeVoiceName(raw) {
  return raw.trim().toLowerCase();
}
function isSelectableVoice(name) {
  return SELECTABLE_VOICES.includes(name);
}
function parseVoiceList(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return void 0;
  const voices = parsed.voices;
  if (!Array.isArray(voices) || !voices.every((v) => typeof v === "string"))
    return void 0;
  return voices;
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

// src/voice/resolve-cli.ts
import {
  spawn,
  spawnSync
} from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
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
      const full = join(dir, name);
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
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
function runCli(cli, args, opts) {
  return needsShell(cli) ? spawnSync(buildShellCommand(cli, args), { ...opts, shell: true }) : spawnSync(cli, args, { ...opts, shell: false });
}
function spawnCli(cli, args, opts) {
  return needsShell(cli) ? spawn(buildShellCommand(cli, args), { ...opts, shell: true }) : spawn(cli, args, { ...opts, shell: false });
}
var MAX_STDOUT_BYTES = 64 * 1024;

// src/lib/hook-payload.ts
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const stdin = process.stdin;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    stdin.on("data", (c) => chunks.push(c));
    stdin.on("end", done);
    stdin.on("error", done);
    stdin.on("close", done);
  });
}

// src/voice/daemon.ts
function normalizeWarm(value) {
  return value === "warming" || value === "warm" || value === "warm_failed" ? value : void 0;
}
function normalizeDegraded(value) {
  return value === "unresponsive" || value === "unregistered" || value === "orphan_resident" ? value : void 0;
}
var DAEMON_STATUS_TIMEOUT_MS = 5e3;
function getDaemonStatus(cliPath, timeoutMs = DAEMON_STATUS_TIMEOUT_MS) {
  let stdout;
  let spawnError;
  let status;
  try {
    const res = runCli(cliPath, ["daemon", "status", "--json"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true
    });
    stdout = res.stdout;
    spawnError = res.error;
    status = typeof res.status === "number" ? res.status : null;
  } catch {
    return { kind: "uncertain", exitCode: null };
  }
  const exitCode = status;
  if (spawnError || typeof stdout !== "string" || !stdout.trim()) {
    return { kind: "uncertain", exitCode };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "uncertain", exitCode };
  }
  if (exitCode !== 0) {
    return { kind: "uncertain", exitCode, raw: parsed };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "uncertain", exitCode, raw: parsed };
  }
  const record = parsed;
  if (record.daemon !== "running" && record.daemon !== "stopped") {
    return { kind: "uncertain", exitCode, raw: parsed };
  }
  if (record.daemon === "running") {
    const warm = normalizeWarm(record.warm);
    return warm ? { kind: "running", exitCode, warm, raw: parsed } : { kind: "running", exitCode, raw: parsed };
  }
  const degraded = normalizeDegraded(record.degraded);
  if (degraded) {
    return { kind: "degraded", exitCode, degraded, raw: parsed };
  }
  return { kind: "stopped", exitCode, raw: parsed };
}
function startDaemonDetached(cliPath, warmVoice) {
  try {
    const args = ["daemon", "start", "--warm-voice", warmVoice];
    const child = spawnCli(cliPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
  }
}

// src/voice/health-decision.ts
var NOT_PROVISIONED_MESSAGE = "EvolutiveX Agents: el entorno de voz no est\xE1 provisionado. Ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz.";
var DOCTOR_FAILED_MESSAGE = "EvolutiveX Agents: el diagn\xF3stico del motor (doctor) fall\xF3 y no produjo un veredicto. Ejecuta ai-voice-interconnector doctor --json manualmente.";
var DOCTOR_JSON_HINT = "Ejecuta ai-voice-interconnector doctor --json para el detalle.";
var RESOURCE_CHECKS = [
  "models_provisioned",
  "onnx_runtime"
];
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
function isValidReport(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value;
  if (!Array.isArray(record.failed) || !record.failed.every((f) => typeof f === "string")) {
    return false;
  }
  if (!Array.isArray(record.checks)) return false;
  for (const check of record.checks) {
    if (typeof check !== "object" || check === null) return false;
    const c = check;
    if (typeof c.name !== "string" || typeof c.ok !== "boolean" || typeof c.detail !== "string") {
      return false;
    }
  }
  if (record.models !== void 0) {
    if (typeof record.models !== "object" || record.models === null) {
      return false;
    }
    const models = record.models;
    if (models.missing !== void 0 && (!Array.isArray(models.missing) || !models.missing.every((m) => typeof m === "string"))) {
      return false;
    }
  }
  return true;
}
function buildFailedMessage(report) {
  const parts = report.failed.map((name) => describeCheck(report, name));
  return `EvolutiveX Agents: el diagn\xF3stico del motor reporta chequeos fallidos. ${parts.join(" ")} ${DOCTOR_JSON_HINT}`;
}
function describeCheck(report, name) {
  const check = report.checks.find((c) => c.name === name);
  if (name === "models_provisioned") {
    const missing = Array.isArray(report.models?.missing) ? report.models.missing.filter((m) => typeof m === "string") : [];
    const missingNote = missing.length > 0 ? ` Modelos sin provisionar: ${missing.join(", ")}.` : "";
    return `${name}: ${NOT_PROVISIONED_MESSAGE}${missingNote}`;
  }
  const detail = check ? check.detail : "";
  return detail ? `${name}: ${detail}.` : `${name}.`;
}
function buildAdvisoryMessage(report) {
  const parts = report.failed.map((name) => describeCheck(report, name));
  return `EvolutiveX Agents: el diagn\xF3stico del motor reporta chequeos de instalaci\xF3n fallidos que no impiden la narraci\xF3n. ${parts.join(" ")} ` + DOCTOR_JSON_HINT;
}
function decideHealthAction(input) {
  const { exitCode, report } = input;
  if (isValidReport(report)) {
    if (exitCode === 0 && report.failed.length === 0) {
      return { kind: "healthy" };
    }
    if (exitCode === 1 && report.failed.length > 0) {
      return report.failed.some((name) => RESOURCE_CHECKS.includes(name)) ? { kind: "notify", message: buildFailedMessage(report) } : { kind: "healthy", advisory: buildAdvisoryMessage(report) };
    }
    return { kind: "uncertain" };
  }
  if (exitCode === 1 && typeof report === "object" && report !== null && report.reason === "doctor_failed") {
    return { kind: "notify", message: DOCTOR_FAILED_MESSAGE };
  }
  return { kind: "uncertain" };
}

// src/voice/active-voice.ts
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync } from "node:fs";
var APP_DIR = "evolutivex-agents";
function stateDir() {
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const base = process.env.LOCALAPPDATA ?? join2(home, "AppData", "Local");
      return join2(base, APP_DIR);
    }
    case "darwin":
      return join2(home, "Library", "Application Support", APP_DIR);
    default: {
      const base = process.env.XDG_STATE_HOME ?? join2(home, ".local", "state");
      return join2(base, APP_DIR);
    }
  }
}
function ensureStateDir() {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
function activeVoicePath() {
  return join2(stateDir(), "active-voice");
}

// src/voice/active-voice.ts
function writeActiveVoice(voice) {
  const path = activeVoicePath();
  const tmpPath = `${path}.${process.pid}.tmp`;
  try {
    ensureStateDir();
    if (readOrUndefined(path) === voice) return;
    writeFileSync(tmpPath, `${voice}
`, "utf8");
    renameSync(tmpPath, path);
  } catch {
    rmSync(tmpPath, { force: true });
  }
}
function readOrUndefined(path) {
  try {
    return readFileSync(path, "utf8").trim() || void 0;
  } catch {
    return void 0;
  }
}

// src/voice/health-check.ts
var DEADLINE_MS = 28e3;
var DOCTOR_TIMEOUT_MS = 2e4;
var DAEMON_STATUS_TIMEOUT_MS2 = 5e3;
var VOICE_LIST_TIMEOUT_MS = 2e3;
var deadline = Date.now() + DEADLINE_MS;
function budget(ms) {
  return Math.max(1, Math.min(ms, deadline - Date.now()));
}
function exitWithSystemMessage(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}
function exitSilently() {
  process.exit(0);
}
function daemonStatusMessage(status) {
  const reason = status.kind === "degraded" ? `el daemon reporta degraded (${status.degraded})` : "el estado del daemon es incierto";
  return `EvolutiveX Agents: ${reason}. Ejecuta ai-voice-interconnector daemon status --json para diagnosticarlo; el daemon no se arranc\xF3.`;
}
function checkVoice(cli, voice) {
  if (voice === DEFAULT_VOICE) return "present";
  const res = runCli(cli, ["voice", "list", "--json"], {
    encoding: "utf8",
    timeout: budget(VOICE_LIST_TIMEOUT_MS),
    windowsHide: true
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string")
    return "uncertain";
  const voices = parseVoiceList(res.stdout);
  if (!voices) return "uncertain";
  return voices.includes(voice) ? "present" : "absent";
}
function voiceCheckMessage(voice, check, daemonStarted) {
  const base = check === "uncertain" ? `EvolutiveX Agents: no se pudo comprobar si la voz ${voice} existe. Ejecuta ai-voice-interconnector voice list --json para diagnosticarlo.` : voice === CUSTOM_VOICE ? "EvolutiveX Agents: elegiste la voz custom, pero todav\xEDa no est\xE1 clonada; cl\xF3nala con /evolutivex-agents:voice clone o elige otra en /config \u2192 evolutivex-agents.voice." : `EvolutiveX Agents: la voz ${voice} no existe; elige otra en /config \u2192 evolutivex-agents.voice.`;
  return daemonStarted ? `${base} El daemon se arranc\xF3 precalentando ${DEFAULT_VOICE}, sin cambiar la voz de la narraci\xF3n.` : base;
}
function handleDaemon(cli, voice, status) {
  if (status.kind === "running") {
    if (status.warm !== "warm_failed") return void 0;
    return "EvolutiveX Agents: el daemon est\xE1 corriendo pero el calentamiento del modelo fall\xF3 (warm_failed); la primera narraci\xF3n puede tardar o fallar. Ejecuta ai-voice-interconnector daemon status --json para el detalle.";
  }
  if (status.kind === "stopped") {
    startDaemonDetached(cli, voice);
    return void 0;
  }
  return daemonStatusMessage(status);
}
function checkDaemonAndVoice(cli, voice) {
  const status = getDaemonStatus(cli, budget(DAEMON_STATUS_TIMEOUT_MS2));
  if (status.kind === "running" || status.kind === "stopped") {
    const check = checkVoice(cli, voice);
    if (check !== "present") {
      const stopped = status.kind === "stopped";
      if (stopped) startDaemonDetached(cli, DEFAULT_VOICE);
      return voiceCheckMessage(voice, check, stopped);
    }
  }
  return handleDaemon(cli, voice, status);
}
async function main() {
  await readStdin();
  const cfg = loadConfig();
  writeActiveVoice(cfg.voice);
  if (!cfg.voiceEnabled) exitSilently();
  if (!isSelectableVoice(cfg.voice)) {
    exitWithSystemMessage(
      `EvolutiveX Agents: la voz \xAB${cfg.voice}\xBB de /config no es una de las opciones (${SELECTABLE_VOICES.join(", ")}). Elige una en /config \u2192 evolutivex-agents.voice; la narraci\xF3n fallar\xE1 hasta corregirlo y el daemon no se arranc\xF3.`
    );
  }
  const cli = resolveCli();
  if (!cli) {
    exitWithSystemMessage(
      "EvolutiveX Agents: AI Voice-InterConnector no est\xE1 en el PATH. Inst\xE1lalo y ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz."
    );
  }
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: budget(DOCTOR_TIMEOUT_MS),
    windowsHide: true
  });
  if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) {
    exitSilently();
  }
  const exitCode = typeof res.status === "number" ? res.status : null;
  const report = parseSingleJsonObject(res.stdout);
  const decision = decideHealthAction({ exitCode, report });
  if (decision.kind === "notify") exitWithSystemMessage(decision.message);
  if (decision.kind === "uncertain") exitSilently();
  const message = [decision.advisory, checkDaemonAndVoice(cli, cfg.voice)].filter(Boolean).join("\n");
  if (message) exitWithSystemMessage(message);
  exitSilently();
}
main().catch(() => process.exit(0));
