// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/voice/narrate-hook.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as join3 } from "node:path";

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
function workerPidPath() {
  return join(stateDir(), "worker.pid");
}
function queueDir() {
  return join(stateDir(), "queue");
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

// src/voice/queue.ts
var MAX_AGE_MS = 60 * 60 * 1e3;
var lastTimeMs = 0;
var seq = 0;
function nextQueueFileName() {
  const now = Date.now();
  if (now > lastTimeMs) {
    lastTimeMs = now;
    seq = 0;
  } else {
    seq += 1;
    if (seq > 999999) {
      lastTimeMs += 1;
      seq = 0;
    }
  }
  const ts = String(lastTimeMs).padStart(13, "0");
  const step = String(seq).padStart(6, "0");
  const pid = String(process.pid).padStart(10, "0");
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${ts}-${step}-${pid}-${rand}.json`;
}
function enqueuePayload(payload) {
  ensureStateDir();
  const dir = queueDir();
  mkdirSync2(dir, { recursive: true });
  const name = nextQueueFileName();
  const finalPath = join2(dir, name);
  const tmpPath = join2(dir, `.tmp-${name}`);
  writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
  renameSync(tmpPath, finalPath);
  return finalPath;
}
function listPending() {
  const dir = queueDir();
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".tmp-")).sort();
  } catch {
    return [];
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

// src/voice/spawn.ts
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

// src/voice/narrate-hook.ts
async function main() {
  const raw = await readStdin();
  const cfg = loadConfig();
  if (!cfg.voiceEnabled) {
    clearQueue();
    return;
  }
  const payload = parsePayload(raw);
  enqueuePayload(payload);
  const owner = readOwnerPid();
  if (!Number.isInteger(owner) || !isAlive(owner)) {
    const here = dirname(fileURLToPath(import.meta.url));
    const worker = join3(here, "narrate-worker.js");
    spawnDetached(process.execPath, [worker]);
  }
}
function readOwnerPid() {
  try {
    return Number.parseInt(readFileSync2(workerPidPath(), "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}
main().catch(() => {
}).finally(() => process.exit(0));
