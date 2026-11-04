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
var FACTORY_VOICES = ["default", "ryan", "vivian"];
var CUSTOM_VOICE = "custom";
var SELECTABLE_VOICES = [
  ...FACTORY_VOICES,
  CUSTOM_VOICE
];
var MIN_ENGINE_VERSION = "0.44.0";
var MAX_DISPLAY_NAME_LENGTH = 64;
function normalizeVoiceName(raw) {
  return raw.trim().toLowerCase();
}
function isFactoryVoice(name) {
  return FACTORY_VOICES.includes(name);
}
function normalizeDisplayName(raw) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "" || [...name].length > MAX_DISPLAY_NAME_LENGTH)
    return void 0;
  if (/[\u0000-\u001f\u007f]/.test(name)) return void 0;
  return name;
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
function meetsMinVersion(version) {
  const actual = parseVersion(version);
  const min = parseVersion(MIN_ENGINE_VERSION);
  if (!actual || !min) return false;
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== min[i]) return actual[i] > min[i];
  }
  return true;
}
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return void 0;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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
function customDisplayNamePath() {
  return join(stateDir(), "custom-display-name");
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
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
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
    rmSync2(voiceOperationLockPath(), { recursive: true, force: true });
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
  rmSync2(voiceOperationLockPath(), { recursive: true, force: true });
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
  try {
    writeFileSync2(join3(dir, "owner"), String(process.pid), "utf8");
  } catch (err) {
    rmSync2(dir, { recursive: true, force: true });
    throw err;
  }
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

// src/voice/custom-display-name.ts
import { readFileSync as readFileSync3, renameSync as renameSync2, rmSync as rmSync3, writeFileSync as writeFileSync3 } from "node:fs";
function writeCustomDisplayName(name) {
  ensureStateDir();
  const path = customDisplayNamePath();
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync3(tmpPath, `${name}
`, "utf8");
  renameSync2(tmpPath, path);
}
function readCustomDisplayName() {
  try {
    return normalizeDisplayName(readFileSync3(customDisplayNamePath(), "utf8"));
  } catch {
    return void 0;
  }
}
function removeCustomDisplayName() {
  rmSync3(customDisplayNamePath(), { force: true });
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

// src/voice/voice-errors.ts
var NOT_COMPLETED_MESSAGE = "No se pudo completar la operaci\xF3n.";
var UNEXPECTED_RESPONSE_MESSAGE = "El motor devolvi\xF3 una respuesta inesperada.";
var AUDIO_HINT = "Usa un WAV v\xE1lido de hasta 30 s; se recomiendan ~10 s.";
var DEVICE_HINT = "No hay micr\xF3fono predeterminado o falta el backend de audio: revisa `ai-voice-interconnector devices`.";
var DENOISE_HINT = "Comprueba la instalaci\xF3n y el modelo de limpieza.";
var REASON_MESSAGES = {
  invalid_voice_name: "Usa letras, n\xFAmeros, punto, guion o guion bajo.",
  audio_not_found: "La ruta de referencia no existe.",
  invalid_audio: AUDIO_HINT,
  empty_audio: AUDIO_HINT,
  audio_too_long: AUDIO_HINT,
  no_input_device: DEVICE_HINT,
  audio_backend_unavailable: DEVICE_HINT,
  transcription_failed: "No se pudo capturar audio: revisa los permisos del micr\xF3fono o usa un WAV.",
  voice_exists: "Ya tienes una voz custom; usa `--force` para reemplazarla.",
  voice_changed: "La voz cambi\xF3 durante la s\xEDntesis; repite la pre-s\xEDntesis.",
  denoise_busy: "Reintenta al terminar la limpieza en curso.",
  denoise_unsupported: DENOISE_HINT,
  denoise_failed: DENOISE_HINT,
  model_missing: "Ejecuta `ai-voice-interconnector setup`.",
  daemon_unreachable: "Levanta el daemon con `ai-voice-interconnector daemon start`.",
  voice_clone_failed: "El clonado fall\xF3; el mensaje del motor indica su log.",
  cannot_remove_default: "Las voces de f\xE1brica no se pueden borrar.",
  voice_not_found: "Consulta `voice list` y elige una voz existente.",
  lifecycle_locked: "Espera a que termine la instalaci\xF3n o limpieza del motor."
};
function engineJson(stdout) {
  if (typeof stdout !== "string") return void 0;
  const payload = parseSingleJsonObject(stdout);
  return typeof payload === "object" && payload !== null ? payload : void 0;
}
var CUSTOM_NOT_CLONED_MESSAGE = "La voz custom todav\xEDa no est\xE1 clonada; cl\xF3nala con /evolutivex-agents:voice clone.";
function engineFailure(run, voice) {
  if (run.error || run.status === null)
    return { exitCode: 1, message: NOT_COMPLETED_MESSAGE };
  if (run.status === 0) return void 0;
  const payload = engineJson(run.stdout);
  if (!payload) return { exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE };
  return {
    exitCode: run.status,
    message: failureMessage(run.status, payload, voice)
  };
}
function failureMessage(status, payload, voice) {
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const hint = reason === "voice_not_found" && voice === CUSTOM_VOICE ? CUSTOM_NOT_CLONED_MESSAGE : Object.hasOwn(REASON_MESSAGES, reason) ? REASON_MESSAGES[reason] : `El motor fall\xF3 con exit ${status}${reason ? ` (${reason})` : ""}.`;
  const error = typeof payload.error === "string" ? payload.error : "";
  return error ? `${error}
${hint}` : hint;
}

// src/narrate-ctl.ts
var SOURCE_LABELS = {
  flag: "indicada",
  cache: "seg\xFAn el \xFAltimo evento",
  default: "sin datos de /config todav\xEDa"
};
function resolveVoice(flag) {
  if (flag !== void 0)
    return { voice: normalizeVoiceName(flag), source: "flag" };
  return readActiveVoice();
}
function voiceDisplayName(voice) {
  const shown = voice === CUSTOM_VOICE ? readCustomDisplayName() : void 0;
  return shown ? `${voice} \xAB${shown}\xBB` : voice;
}
function describeVoice({ voice, source }) {
  return `${voiceDisplayName(voice)} (${SOURCE_LABELS[source]})`;
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
  const res = runCli(cli, [...args, "--daemon", "--json"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true
  });
  const failure = engineFailure(res, voice.voice);
  return failure ? reportFailure(failure) : 0;
}
function presynth(voice, force, resynth = force) {
  const cli = requireCli("pre-sintetizar");
  if (!cli) return 1;
  return withVoiceOperationLock(() => {
    console.log(`voz: ${describeVoice(voice)}`);
    let failed = false;
    for (const [eventKey, { text, label }] of Object.entries(ANNOUNCEMENTS)) {
      const args = ["speech", "synthesize", "--text", text, "--label", label];
      args.push("--voice", voice.voice);
      if (force) args.push("--force");
      else args.push("--skip-existing");
      args.push("--daemon", "--json");
      const res = runCli(cli, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        windowsHide: true
      });
      if (!reportPresynth(eventKey, label, voice.voice, res, resynth))
        failed = true;
    }
    return failed ? 1 : 0;
  });
}
function reportPresynth(eventKey, label, voice, res, resynth) {
  const failure = engineFailure(res, voice);
  if (!failure) {
    const status = engineJson(res.stdout)?.status;
    if (status === "skipped") {
      console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    } else {
      console.log(
        `${eventKey}: ${resynth ? "re-sintetizado" : "pre-sintetizado"} (${label})`
      );
    }
    return true;
  }
  const reason = engineJson(res.stdout)?.reason;
  const detail = res.status === null ? "no se pudo completar" : `exit ${res.status}${typeof reason === "string" ? `, ${reason}` : ""}`;
  console.error(
    `${eventKey}: fallo (${detail}) (${label}) \u2014 ${failure.message}`
  );
  return false;
}
function reportFailure(failure) {
  console.error(failure.message);
  return failure.exitCode;
}
function meetsEngineVersion(cli) {
  const res = runCli(cli, ["version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5e3,
    windowsHide: true
  });
  const version = res.status === 0 ? engineJson(res.stdout)?.version : "";
  if (typeof version === "string" && meetsMinVersion(version)) return true;
  console.error(
    `La gesti\xF3n de voces requiere AI Voice-InterConnector ${MIN_ENGINE_VERSION} o posterior.`
  );
  return false;
}
function requireVoiceCli(action) {
  const cli = requireCli(action);
  return cli && meetsEngineVersion(cli) ? cli : void 0;
}
function voiceList() {
  const cli = requireVoiceCli("listar las voces");
  if (!cli) return 1;
  const res = runCli(cli, ["voice", "list", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true
  });
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  const voices = typeof res.stdout === "string" ? parseVoiceList(res.stdout) : void 0;
  if (!voices)
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  const active = readActiveVoice();
  console.log(`voz activa: ${describeVoice(active)}`);
  for (const voice of voices) {
    const tags = [
      isFactoryVoice(voice) ? "f\xE1brica" : "",
      voice === CUSTOM_VOICE ? "tu voz" : "",
      voice === active.voice ? "activa" : ""
    ].filter(Boolean);
    const name = voiceDisplayName(voice);
    console.log(`  ${name}${tags.length ? ` (${tags.join(", ")})` : ""}`);
  }
  if (!voices.includes(CUSTOM_VOICE))
    console.log(
      `  ${CUSTOM_VOICE} (sin clonar; cl\xF3nala con /evolutivex-agents:voice clone)`
    );
  if (!voices.includes(active.voice))
    console.log(
      `Aviso: la voz activa ${active.voice} no existe en el motor; la narraci\xF3n fallar\xE1 hasta clonarla o elegir otra en /config \u2192 evolutivex-agents.voice.`
    );
  return 0;
}
function parseClone(rest) {
  const parsed = parseOptions(rest, {
    "display-name": { type: "string" },
    mic: { type: "boolean" },
    duration: { type: "string" },
    force: { type: "boolean", short: "f" },
    denoise: { type: "boolean" }
  });
  if (!parsed) return void 0;
  const [wav, ...extra] = parsed.positionals;
  const mic = parsed.values.mic === true;
  const duration = parsed.values.duration;
  const rawDisplayName = parsed.values["display-name"];
  const displayName = rawDisplayName === void 0 ? void 0 : normalizeDisplayName(rawDisplayName);
  if (extra.length > 0 || mic === (wav !== void 0)) return void 0;
  if (duration !== void 0 && !mic) return void 0;
  if (rawDisplayName !== void 0 && displayName === void 0)
    return void 0;
  return {
    displayName,
    wav,
    mic,
    duration,
    force: parsed.values.force === true,
    denoise: parsed.values.denoise === true
  };
}
function cloneArgs(req) {
  const args = ["voice", "clone", "--name", CUSTOM_VOICE];
  if (req.wav !== void 0) args.push("--speech-reference", req.wav);
  else args.push("--mic");
  if (req.duration !== void 0) args.push("--duration", req.duration);
  if (req.force) args.push("--force", "--yes");
  if (req.denoise) args.push("--denoise");
  args.push("--daemon", "--json");
  return args;
}
function voiceClone(rest) {
  const req = parseClone(rest);
  if (!req) {
    console.error(
      'Uso: voice clone [--display-name "<nombre>"] (<ruta.wav> | --mic [--duration <segs>]) [--force] [--denoise]'
    );
    console.error(
      "El nombre de presentaci\xF3n tiene de 1 a 64 caracteres, sin saltos de l\xEDnea."
    );
    return 2;
  }
  if (req.mic && req.duration === void 0 && !process.stdin.isTTY) {
    console.error(
      "Usa `--duration <segs>` (se sugieren 10) o ejecuta el comando en tu terminal para el push-to-talk."
    );
    return 2;
  }
  const cli = requireVoiceCli("clonar la voz");
  if (!cli) return 1;
  return withVoiceOperationLock(() => runClone(cli, req));
}
function runClone(cli, req) {
  const res = runCli(cli, cloneArgs(req), {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true
  });
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  const payload = engineJson(res.stdout);
  if (!payload)
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  if (req.displayName) writeCustomDisplayName(req.displayName);
  else removeCustomDisplayName();
  const name = voiceDisplayName(CUSTOM_VOICE);
  const removed = payload.removed_speech;
  if (Array.isArray(removed) && removed.length > 0)
    console.log(`Locuciones anteriores borradas: ${removed.join(", ")}.`);
  console.log(`Voz ${name} clonada; pre-sintetizando sus anuncios\u2026`);
  if (presynth({ voice: CUSTOM_VOICE, source: "flag" }, true, false) !== 0) {
    console.error(
      `La huella de la voz ${name} ya cambi\xF3, pero la pre-s\xEDntesis fall\xF3; reintenta con: narrate-ctl presynth --voice ${CUSTOM_VOICE} --force`
    );
    return 1;
  }
  console.log(
    `Voz ${name} lista. Para usarla, elige ${CUSTOM_VOICE} en /config \u2192 evolutivex-agents.voice`
  );
  return 0;
}
function voiceRemove(rest) {
  const parsed = parseOptions(rest, { yes: { type: "boolean" } });
  const name = normalizeVoiceName(parsed?.positionals[0] ?? "");
  if (!parsed || parsed.positionals.length !== 1 || !name) {
    console.error("Uso: voice remove <nombre> --yes");
    return 2;
  }
  if (parsed.values.yes !== true) {
    console.error("Confirma el borrado con `--yes`.");
    return 2;
  }
  const cli = requireVoiceCli("borrar la voz");
  if (!cli) return 1;
  return withVoiceOperationLock(() => runRemove(cli, name));
}
function runRemove(cli, name) {
  const res = runCli(
    cli,
    ["voice", "remove", "--name", name, "--yes", "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true
    }
  );
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  const removed = engineJson(res.stdout)?.removed_speech;
  if (!Array.isArray(removed))
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  const shown = voiceDisplayName(name);
  if (name === CUSTOM_VOICE) removeCustomDisplayName();
  console.log(
    `Voz ${shown} borrada; locuciones borradas: ${removed.length > 0 ? removed.join(", ") : "ninguna"}.`
  );
  const active = readActiveVoice();
  if (active.source === "cache" && active.voice === name)
    console.log(
      `Aviso: ${name} es la voz activa seg\xFAn el \xFAltimo evento; la narraci\xF3n fallar\xE1 hasta elegir otra en /config \u2192 evolutivex-agents.voice.`
    );
  return 0;
}
function runVoice([sub, ...rest]) {
  switch (sub) {
    case "list":
      if (rest.length === 0) return voiceList();
      break;
    case "clone":
      return voiceClone(rest);
    case "remove":
      return voiceRemove(rest);
  }
  console.error(
    'Uso: voice list | voice clone [--display-name "<nombre>"] (<ruta.wav> | --mic [--duration <segs>]) [--force] [--denoise] | voice remove <voz> --yes'
  );
  return 2;
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
function parseSayArgs(rest) {
  const words = [];
  let voiceFlag;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--") {
      words.push(...rest.slice(i + 1));
      break;
    }
    if (arg === "--voice") {
      if (i + 1 >= rest.length) return void 0;
      voiceFlag = rest[++i];
    } else if (arg.startsWith("--voice=")) {
      voiceFlag = arg.slice("--voice=".length);
    } else {
      words.push(arg);
    }
  }
  return { text: words.join(" ").trim(), voiceFlag };
}
function runSay(rest) {
  const parsed = parseSayArgs(rest);
  const voice = resolveVoice(parsed?.voiceFlag);
  if (!parsed?.text || !voice.voice) {
    console.error('Uso: say [--voice <nombre>] "<texto>"');
    return 2;
  }
  return say(parsed.text, voice);
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
    case "voice":
      return runVoice(rest);
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
