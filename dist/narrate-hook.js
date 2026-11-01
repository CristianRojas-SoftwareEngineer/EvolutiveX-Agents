// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// src/narrate-hook.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as join3 } from "node:path";

// src/lib/config.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/lib/state-dir.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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
function ensureStateDir() {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
function configPath() {
  return join(stateDir(), "config.json");
}
function workerPidPath() {
  return join(stateDir(), "worker.pid");
}
function queueDir() {
  return join(stateDir(), "queue");
}

// src/lib/config.ts
var DEFAULTS = {
  enabled: true,
  desktopEnabled: true,
  messageMode: "local"
};
function readFileConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { enabled, desktopEnabled, messageMode } = parsed;
      return { enabled, desktopEnabled, messageMode };
    }
  } catch {
  }
  return {};
}
function loadConfig() {
  const file = readFileConfig();
  return {
    enabled: typeof file.enabled === "boolean" ? file.enabled : DEFAULTS.enabled,
    desktopEnabled: typeof file.desktopEnabled === "boolean" ? file.desktopEnabled : DEFAULTS.desktopEnabled,
    messageMode: file.messageMode === "llm" ? "llm" : DEFAULTS.messageMode,
    geminiApiKey: emptyToUndef(process.env.GEMINI_API_KEY)
  };
}
function emptyToUndef(v) {
  return typeof v === "string" && v.trim() !== "" ? v : void 0;
}

// src/lib/queue.ts
import {
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync as writeFileSync2
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

// src/lib/queue.ts
var MAX_AGE_MS = 60 * 60 * 1e3;
function enqueuePayload(payload) {
  ensureStateDir();
  const dir = queueDir();
  mkdirSync2(dir, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  const finalPath = join2(dir, name);
  const tmpPath = join2(dir, `.tmp-${name}`);
  writeFileSync2(tmpPath, JSON.stringify(payload), "utf8");
  renameSync(tmpPath, finalPath);
  return finalPath;
}

// src/lib/spawn.ts
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

// src/narrate-hook.ts
async function main() {
  const raw = await readStdin();
  const cfg = loadConfig();
  if (!cfg.enabled) return;
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
    return Number.parseInt(readFileSync3(workerPidPath(), "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}
main().catch(() => {
}).finally(() => process.exit(0));
