// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/lib/config.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
var APP_DIR = "agent-voice-interconnector";
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
function configPath() {
  return join(stateDir(), "config.json");
}

// src/lib/config.ts
var DEFAULTS = {
  voiceEnabled: true,
  notificationsEnabled: true,
  messageMode: "local"
};
function readFileConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { voiceEnabled, notificationsEnabled, messageMode } = parsed;
      return { voiceEnabled, notificationsEnabled, messageMode };
    }
  } catch {
  }
  return {};
}
function loadConfig() {
  const file = readFileConfig();
  return {
    voiceEnabled: typeof file.voiceEnabled === "boolean" ? file.voiceEnabled : DEFAULTS.voiceEnabled,
    notificationsEnabled: typeof file.notificationsEnabled === "boolean" ? file.notificationsEnabled : DEFAULTS.notificationsEnabled,
    messageMode: file.messageMode === "llm" ? "llm" : DEFAULTS.messageMode,
    geminiApiKey: emptyToUndef(process.env.GEMINI_API_KEY)
  };
}
function emptyToUndef(v) {
  return typeof v === "string" && v.trim() !== "" ? v : void 0;
}

// src/lib/resolve-cli.ts
import {
  spawn,
  spawnSync
} from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join as join2 } from "node:path";
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
      const full = join2(dir, name);
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

// src/lib/daemon.ts
function normalizeWarm(value) {
  return value === "warming" || value === "warm" || value === "warm_failed" ? value : void 0;
}
function normalizeDegraded(value) {
  return value === "unresponsive" || value === "unregistered" || value === "orphan_resident" ? value : void 0;
}
function getDaemonStatus(cliPath) {
  let stdout;
  let spawnError;
  let status;
  try {
    const res = runCli(cliPath, ["daemon", "status", "--json"], {
      encoding: "utf8",
      // Presupuesto de SessionStart: doctor ≤20 s + status ≤5 s = 25 s de
      // subprocesses con ≥5 s de margen bajo el timeout de 30 s del hook.
      timeout: 5e3,
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
function startDaemonDetached(cliPath) {
  try {
    const child = spawnCli(cliPath, ["daemon", "start"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
  }
}

// src/lib/health-decision.ts
var NOT_PROVISIONED_MESSAGE = "Agent Voice-InterConnector: el entorno de voz no est\xE1 provisionado. Ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz.";
var DOCTOR_FAILED_MESSAGE = "Agent Voice-InterConnector: el diagn\xF3stico del motor (doctor) fall\xF3 y no produjo un veredicto. Ejecuta ai-voice-interconnector doctor --json manualmente.";
var DOCTOR_JSON_HINT = "Ejecuta ai-voice-interconnector doctor --json para el detalle.";
var RESOURCE_CHECKS = [
  "models_provisioned",
  "onnx_runtime"
];
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
  return `Agent Voice-InterConnector: el diagn\xF3stico del motor reporta chequeos fallidos. ${parts.join(" ")} ${DOCTOR_JSON_HINT}`;
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
  return `Agent Voice-InterConnector: el diagn\xF3stico del motor reporta chequeos de instalaci\xF3n fallidos que no impiden la narraci\xF3n. ${parts.join(" ")} ` + DOCTOR_JSON_HINT;
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

// src/health-check.ts
function exitWithSystemMessage(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}
function exitSilently() {
  process.exit(0);
}
function daemonStatusMessage(status) {
  const reason = status.kind === "degraded" ? `el daemon reporta degraded (${status.degraded})` : "el estado del daemon es incierto";
  return `Agent Voice-InterConnector: ${reason}. Ejecuta ai-voice-interconnector daemon status --json para diagnosticarlo; el daemon no se arranc\xF3.`;
}
async function main() {
  await readStdin();
  const cfg = loadConfig();
  if (!cfg.voiceEnabled) exitSilently();
  const cli = resolveCli();
  if (!cli) {
    exitWithSystemMessage(
      "Agent Voice-InterConnector: AI Voice-InterConnector no est\xE1 en el PATH. Inst\xE1lalo y ejecuta ai-voice-interconnector setup para habilitar la narraci\xF3n por voz."
    );
  }
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: 2e4,
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
  const status = getDaemonStatus(cli);
  if (status.kind === "running") {
    if (status.warm === "warm_failed") {
      exitWithSystemMessage(
        "Agent Voice-InterConnector: el daemon est\xE1 corriendo pero el calentamiento del modelo fall\xF3 (warm_failed); la primera narraci\xF3n puede tardar o fallar. Ejecuta ai-voice-interconnector daemon status --json para el detalle."
      );
    }
    exitSilently();
  }
  if (status.kind === "stopped") {
    startDaemonDetached(cli);
    exitSilently();
  }
  exitWithSystemMessage(daemonStatusMessage(status));
}
main().catch(() => process.exit(0));
