// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

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

// src/voice/resolve-cli.ts
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

// src/narrate-ctl.ts
function printStatus() {
  const cfg = loadConfig();
  const lines = [
    `preferencias:   /config \u2192 evolutivex-agents.*`,
    `gemini key:     ${cfg.geminiApiKey ? "configurada" : "ausente"}`,
    `state dir:      ${stateDir()}`
  ];
  console.log(lines.join("\n"));
}
function say(text) {
  const cli = resolveCli();
  if (!cli) {
    console.error(
      "ai-voice-interconnector no est\xE1 en el PATH; no se puede narrar."
    );
    return 1;
  }
  const res = runCli(cli, ["speech", "say", "--text", text, "--daemon"], {
    stdio: "inherit",
    windowsHide: true
  });
  return res.status ?? 0;
}
function presynth(force) {
  const cli = resolveCli();
  if (!cli) {
    console.error(
      "ai-voice-interconnector no est\xE1 en el PATH; no se puede pre-sintetizar."
    );
    return 1;
  }
  let failed = false;
  for (const [eventKey, { text, label }] of Object.entries(ANNOUNCEMENTS)) {
    const args = ["speech", "synthesize", "--text", text, "--label", label];
    if (force) args.push("--force");
    args.push("--daemon");
    const res = runCli(cli, args, {
      stdio: ["ignore", "ignore", "inherit"],
      windowsHide: true
    });
    const code = res.status ?? 1;
    if (code === 0)
      console.log(
        `${eventKey}: ${force ? "re-sintetizado" : "pre-sintetizado"} (${label})`
      );
    else if (code === 6)
      console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    else {
      failed = true;
      const reason = code === 5 ? " \u2014 daemon ca\xEDdo; lev\xE1ntalo con `ai-voice-interconnector daemon start`" : code === 4 ? " \u2014 modelo ausente; provisi\xF3nalo con `ai-voice-interconnector setup`" : "";
      console.error(`${eventKey}: fallo (exit ${code})${reason}`);
    }
  }
  return failed ? 1 : 0;
}
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "status":
    case void 0:
      printStatus();
      return 0;
    case "say": {
      const text = rest.join(" ").trim();
      if (!text) {
        console.error('Uso: say "<texto>"');
        return 2;
      }
      return say(text);
    }
    case "presynth": {
      const force = rest[0] === "--force" || rest[0] === "-f";
      if (rest.length > 1 || rest.length === 1 && !force) {
        console.error("Uso: presynth [--force]");
        return 2;
      }
      return presynth(force);
    }
    default:
      console.error(`Comando desconocido: ${cmd}`);
      return 2;
  }
}
process.exit(main());
