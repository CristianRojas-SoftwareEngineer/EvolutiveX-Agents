// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/narrate-ctl.ts
import { parseArgs } from "node:util";

// src/voice/voice.ts
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
function activeVoicePath() {
  return join(stateDir(), "active-voice");
}
function voiceOperationLockPath() {
  return join(stateDir(), "voice-operation.lock");
}

// src/voice/resolve-cli.ts
import {
  spawn,
  spawnSync
} from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join as join2 } from "node:path";

// src/voice/spawn.ts
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
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
var MAX_STDOUT_BYTES = 64 * 1024;

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

// src/voice/active-voice.ts
import { readFileSync, writeFileSync } from "node:fs";
function readActiveVoice() {
  const voice = readOrUndefined(activeVoicePath());
  return voice ? { voice, source: "cache" } : { voice: DEFAULT_VOICE, source: "default" };
}
function readOrUndefined(path) {
  try {
    return readFileSync(path, "utf8").trim() || void 0;
  } catch {
    return void 0;
  }
}

// src/voice/operation-lock.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var LOCK_BUSY_EXIT = 6;
var depth = 0;
function withVoiceOperationLock(fn) {
  if (depth > 0) return runNested(fn);
  if (!acquire()) {
    console.error(
      `Hay otra operaci\xF3n de voz en curso; si no es as\xED, borra ${voiceOperationLockPath()}.`
    );
    return LOCK_BUSY_EXIT;
  }
  try {
    return runNested(fn);
  } finally {
    rmSync(voiceOperationLockPath(), { recursive: true, force: true });
  }
}
function runNested(fn) {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}
function acquire() {
  ensureStateDir();
  if (tryCreate()) return true;
  const owner = readOwner();
  if (owner === void 0 || isAlive(owner)) return false;
  rmSync(voiceOperationLockPath(), { recursive: true, force: true });
  return tryCreate();
}
function tryCreate() {
  const dir = voiceOperationLockPath();
  try {
    mkdirSync2(dir);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
  writeFileSync2(join3(dir, "owner"), String(process.pid), "utf8");
  return true;
}
function readOwner() {
  try {
    const raw = readFileSync2(join3(voiceOperationLockPath(), "owner"), "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : void 0;
  } catch {
    return void 0;
  }
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
  let depth2 = 0;
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
    else if (ch === "{") depth2++;
    else if (ch === "}") {
      depth2--;
      if (depth2 === 0) return i;
    }
  }
  return -1;
}

// src/narrate-ctl.ts
var SOURCE_LABELS = {
  flag: "--voice",
  cache: "seg\xFAn el \xFAltimo evento",
  default: "sin datos de /config todav\xEDa"
};
function resolveVoice(flag) {
  if (flag !== void 0)
    return { voice: normalizeVoiceName(flag), source: "flag" };
  return readActiveVoice();
}
function describeVoice({ voice, source }) {
  return `${voice} (${SOURCE_LABELS[source]})`;
}
function printStatus() {
  const cfg = loadConfig();
  const lines = [
    `preferencias:   /config \u2192 evolutivex-agents.*`,
    `voz activa:     ${describeVoice(readActiveVoice())}`,
    `gemini key:     ${cfg.geminiApiKey ? "configurada" : "ausente"}`,
    `state dir:      ${stateDir()}`
  ];
  console.log(lines.join("\n"));
}
function requireCli(action) {
  const cli = resolveCli();
  if (!cli)
    console.error(
      `ai-voice-interconnector no est\xE1 en el PATH; no se puede ${action}.`
    );
  return cli;
}
function say(text, voice) {
  const cli = requireCli("narrar");
  if (!cli) return 1;
  console.log(`voz: ${describeVoice(voice)}`);
  const args = ["speech", "say", "--text", text, "--voice", voice.voice];
  const res = runCli(cli, [...args, "--daemon"], {
    stdio: "inherit",
    windowsHide: true
  });
  return typeof res.status === "number" ? res.status : 1;
}
function presynth(voice, force) {
  const cli = requireCli("pre-sintetizar");
  if (!cli) return 1;
  return withVoiceOperationLock(() => {
    console.log(`voz: ${describeVoice(voice)}`);
    let failed = false;
    for (const [eventKey, { text, label }] of Object.entries(ANNOUNCEMENTS)) {
      const args = ["speech", "synthesize", "--text", text, "--label", label];
      args.push("--voice", voice.voice);
      if (force) args.push("--force");
      args.push("--daemon", "--json");
      const res = runCli(cli, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        windowsHide: true
      });
      const code = typeof res.status === "number" ? res.status : null;
      const reason = reasonOf(res.stdout);
      if (!reportPresynth(eventKey, label, code, reason, force)) failed = true;
    }
    return failed ? 1 : 0;
  });
}
function reasonOf(stdout) {
  if (typeof stdout !== "string") return void 0;
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return void 0;
  const reason = payload.reason;
  return typeof reason === "string" ? reason : void 0;
}
function reportPresynth(eventKey, label, code, reason, force) {
  if (code === 0) {
    console.log(
      `${eventKey}: ${force ? "re-sintetizado" : "pre-sintetizado"} (${label})`
    );
    return true;
  }
  if (code === 6 && reason === "label_exists") {
    console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    return true;
  }
  const hint = code === 5 ? " \u2014 daemon ca\xEDdo; lev\xE1ntalo con `ai-voice-interconnector daemon start`" : code === 4 ? " \u2014 modelo ausente; provisi\xF3nalo con `ai-voice-interconnector setup`" : "";
  const detail = code === null ? "no se pudo completar" : `exit ${code}`;
  console.error(
    `${eventKey}: fallo (${detail}${reason ? `, ${reason}` : ""})${hint}`
  );
  return false;
}
function parseOptions(rest, options) {
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options,
      allowPositionals: true,
      strict: true
    });
    return {
      values,
      positionals
    };
  } catch {
    return void 0;
  }
}
function runSay(rest) {
  const parsed = parseOptions(rest, { voice: { type: "string" } });
  const text = parsed?.positionals.join(" ").trim();
  const voice = resolveVoice(parsed?.values.voice);
  if (!parsed || !text || !voice.voice) {
    console.error('Uso: say [--voice <nombre>] "<texto>"');
    return 2;
  }
  return say(text, voice);
}
function runPresynth(rest) {
  const parsed = parseOptions(rest, {
    voice: { type: "string" },
    force: { type: "boolean", short: "f" }
  });
  const voice = resolveVoice(parsed?.values.voice);
  if (!parsed || parsed.positionals.length > 0 || !voice.voice) {
    console.error("Uso: presynth [--voice <nombre>] [--force]");
    return 2;
  }
  return presynth(voice, parsed.values.force === true);
}
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "status":
    case void 0:
      printStatus();
      return 0;
    case "say":
      return runSay(rest);
    case "presynth":
      return runPresynth(rest);
    default:
      console.error(`Comando desconocido: ${cmd}`);
      return 2;
  }
}
var exitCode;
try {
  exitCode = main();
} catch {
  console.error("No se pudo completar la operaci\xF3n.");
  exitCode = 1;
}
process.exit(exitCode);
