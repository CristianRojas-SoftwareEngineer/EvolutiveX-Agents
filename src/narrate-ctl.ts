// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Superficie de control de la narración (para la skill y uso manual). Las
// preferencias se configuran en /config → evolutivex-agents.* y no se leen
// aquí: la herramienta Bash no recibe las variables de userConfig. La voz
// activa sale de `--voice` o, si no se indica, de la caché `active-voice` que
// escriben los hooks (o `default` sin caché). La API key se lee del entorno.
// No participa en el flujo de hooks.
//
// Uso: node dist/narrate-ctl.js <comando> [args]
//   status                                  muestra el estado y la voz activa (sin revelar las claves)
//   say [--voice <nombre>] "<texto>"        narra un texto a demanda vía ai-voice-interconnector
//   presynth [--voice <nombre>] [--force]   pre-sintetiza los anuncios estáticos con la voz
//                                           (idempotente; --force reescribe)
//   voice list                              lista las voces y marca las de fábrica y la activa
//   voice clone <nombre> <ruta.wav> [--force] [--denoise]
//   voice clone <nombre> --mic [--duration <segs>] [--force] [--denoise]
//                                           clona una voz y pre-sintetiza sus anuncios
//   voice remove <nombre> --yes             borra una voz de usuario y sus locuciones
//
// Las operaciones `voice *` exigen la versión mínima del motor; `voice clone`,
// `voice remove` y `presynth` se excluyen entre sí con voice-operation.lock.
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.js";
import { stateDir } from "./lib/state-dir.js";
import { resolveCli, runCli } from "./voice/resolve-cli.js";
import { ANNOUNCEMENTS } from "./voice/message/static-announcements.js";
import { readActiveVoice } from "./voice/active-voice.js";
import { withVoiceOperationLock } from "./voice/operation-lock.js";
import {
  MIN_ENGINE_VERSION,
  isFactoryVoice,
  meetsMinVersion,
  normalizeVoiceName,
  parseVoiceList,
} from "./voice/voice.js";
import {
  UNEXPECTED_RESPONSE_MESSAGE,
  engineFailure,
  engineJson,
  type EngineFailure,
  type EngineRun,
} from "./voice/voice-errors.js";

/** Voz resuelta para una operación y de dónde salió. */
interface ResolvedVoice {
  voice: string;
  source: "flag" | "cache" | "default";
}

const SOURCE_LABELS: Record<ResolvedVoice["source"], string> = {
  flag: "--voice",
  cache: "según el último evento",
  default: "sin datos de /config todavía",
};

/** `--voice`, luego la caché de los hooks y por último `default`. */
function resolveVoice(flag: string | undefined): ResolvedVoice {
  if (flag !== undefined)
    return { voice: normalizeVoiceName(flag), source: "flag" };
  return readActiveVoice();
}

function describeVoice({ voice, source }: ResolvedVoice): string {
  return `${voice} (${SOURCE_LABELS[source]})`;
}

function printStatus(): void {
  const cfg = loadConfig();
  const lines = [
    `preferencias:   /config → evolutivex-agents.*`,
    `voz activa:     ${describeVoice(readActiveVoice())}`,
    `gemini key:     ${cfg.geminiApiKey ? "configurada" : "ausente"}`,
    `state dir:      ${stateDir()}`,
  ];
  console.log(lines.join("\n"));
}

/** CLI resuelto o undefined tras avisar por stderr. */
function requireCli(action: string): string | undefined {
  const cli = resolveCli();
  if (!cli)
    console.error(
      `ai-voice-interconnector no está en el PATH; no se puede ${action}.`,
    );
  return cli;
}

function say(text: string, voice: ResolvedVoice): number {
  const cli = requireCli("narrar");
  if (!cli) return 1;
  console.log(`voz: ${describeVoice(voice)}`);
  const args = ["speech", "say", "--text", text, "--voice", voice.voice];
  const res = runCli(cli, [...args, "--daemon"], {
    stdio: "inherit",
    windowsHide: true,
  });
  // Un hijo no iniciado o terminado por señal es un fallo, nunca un éxito.
  return typeof res.status === "number" ? res.status : 1;
}

/**
 * Pre-sintetiza los anuncios del catálogo con la voz indicada, vía
 * `speech synthesize --voice <voz> --daemon --json`, bajo el bloqueo de
 * operaciones manuales. Idempotente por defecto: solo el exit `6` con `reason:
 * label_exists` significa «ya pre-sintetizado» y cuenta como éxito. Con
 * `force`, pasa `--force` al motor para sobrescribir el WAV del label
 * existente: el re-sync manual tras un cambio de frase o un re-clonado.
 * Requiere el daemon caliente (exit `5` si está caído) y el modelo
 * provisionado (exit `4`). Devuelve 1 si algún anuncio falla.
 */
function presynth(voice: ResolvedVoice, force: boolean): number {
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
        windowsHide: true,
      });
      if (!reportPresynth(eventKey, label, res, force)) failed = true;
    }
    return failed ? 1 : 0;
  });
}

/**
 * Informa el resultado de pre-sintetizar un anuncio. Devuelve false si falló;
 * solo el exit `6` con `label_exists` cuenta como éxito idempotente.
 */
function reportPresynth(
  eventKey: string,
  label: string,
  res: EngineRun,
  force: boolean,
): boolean {
  const failure = engineFailure(res);
  if (!failure) {
    console.log(
      `${eventKey}: ${force ? "re-sintetizado" : "pre-sintetizado"} (${label})`,
    );
    return true;
  }
  const reason = engineJson(res.stdout)?.reason;
  if (res.status === 6 && reason === "label_exists") {
    console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    return true;
  }
  const detail =
    res.status === null
      ? "no se pudo completar"
      : `exit ${res.status}${typeof reason === "string" ? `, ${reason}` : ""}`;
  console.error(
    `${eventKey}: fallo (${detail}) (${label}) — ${failure.message}`,
  );
  return false;
}

/** Informa un fallo del motor o del plugin y devuelve su exit. */
function reportFailure(failure: EngineFailure): number {
  console.error(failure.message);
  return failure.exitCode;
}

/**
 * ¿El motor instalado alcanza la versión mínima de la gestión de voces? Lo
 * comprueba con `version --json` (timeout de 5 s); una versión inferior o
 * ilegible se informa por stderr.
 */
function meetsEngineVersion(cli: string): boolean {
  const res = runCli(cli, ["version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    windowsHide: true,
  });
  const version = res.status === 0 ? engineJson(res.stdout)?.version : "";
  if (typeof version === "string" && meetsMinVersion(version)) return true;
  console.error(
    `La gestión de voces requiere AI Voice-InterConnector ${MIN_ENGINE_VERSION} o posterior.`,
  );
  return false;
}

/** CLI resuelto con la versión mínima de la gestión de voces, o undefined. */
function requireVoiceCli(action: string): string | undefined {
  const cli = requireCli(action);
  return cli && meetsEngineVersion(cli) ? cli : undefined;
}

/** `voice list`: imprime las voces y marca las de fábrica y la activa. */
function voiceList(): number {
  const cli = requireVoiceCli("listar las voces");
  if (!cli) return 1;
  const res = runCli(cli, ["voice", "list", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  const voices =
    typeof res.stdout === "string" ? parseVoiceList(res.stdout) : undefined;
  if (!voices)
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  const active = readActiveVoice();
  console.log(`voz activa: ${describeVoice(active)}`);
  for (const voice of voices) {
    const tags = [
      isFactoryVoice(voice) ? "fábrica" : "",
      voice === active.voice ? "activa" : "",
    ].filter(Boolean);
    console.log(`  ${voice}${tags.length ? ` (${tags.join(", ")})` : ""}`);
  }
  return 0;
}

/** Petición de clonado ya parseada. */
interface CloneRequest {
  name: string;
  wav?: string;
  mic: boolean;
  duration?: string;
  force: boolean;
  denoise: boolean;
}

/** Parsea `voice clone`; exige el nombre y exactamente una fuente. */
function parseClone(rest: string[]): CloneRequest | undefined {
  const parsed = parseOptions(rest, {
    mic: { type: "boolean" },
    duration: { type: "string" },
    force: { type: "boolean", short: "f" },
    denoise: { type: "boolean" },
  });
  if (!parsed) return undefined;
  const [rawName, wav, ...extra] = parsed.positionals;
  const name = normalizeVoiceName(rawName ?? "");
  const mic = parsed.values.mic === true;
  if (!name || extra.length > 0 || mic === (wav !== undefined))
    return undefined;
  return {
    name,
    wav,
    mic,
    duration: parsed.values.duration as string | undefined,
    force: parsed.values.force === true,
    denoise: parsed.values.denoise === true,
  };
}

/** Argumentos de `voice clone` del motor, siempre con `--daemon --json`. */
function cloneArgs(req: CloneRequest): string[] {
  const args = ["voice", "clone", "--name", req.name];
  if (req.wav !== undefined) args.push("--speech-reference", req.wav);
  else args.push("--mic");
  if (req.duration !== undefined) args.push("--duration", req.duration);
  if (req.force) args.push("--force");
  if (req.denoise) args.push("--denoise");
  args.push("--daemon", "--json");
  return args;
}

/**
 * `voice clone`: rechaza las voces de fábrica y el push-to-talk sin terminal
 * antes de invocar al motor; luego, con la versión mínima y el bloqueo, clona
 * y pre-sintetiza los anuncios con la voz nueva.
 */
function voiceClone(rest: string[]): number {
  const req = parseClone(rest);
  if (!req) {
    console.error(
      "Uso: voice clone <nombre> (<ruta.wav> | --mic [--duration <segs>]) [--force] [--denoise]",
    );
    return 2;
  }
  if (isFactoryVoice(req.name)) {
    console.error(
      "`default`, `ryan` y `vivian` son voces de fábrica; elige otro nombre.",
    );
    return 2;
  }
  if (req.mic && req.duration === undefined && !process.stdin.isTTY) {
    console.error(
      "Usa `--duration <segs>` (se sugieren 10) o ejecuta el comando en tu terminal para el push-to-talk.",
    );
    return 2;
  }
  const cli = requireVoiceCli("clonar la voz");
  if (!cli) return 1;
  return withVoiceOperationLock(() => runClone(cli, req));
}

/**
 * Clona con stdin y stderr heredados (push-to-talk y progreso) y stdout
 * capturado para el JSON, y termina con `presynth --voice <nombre> --force`
 * dentro del mismo bloqueo. Solo con los seis anuncios pre-sintetizados indica
 * el valor de /config.
 */
function runClone(cli: string, req: CloneRequest): number {
  const res = runCli(cli, cloneArgs(req), {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true,
  });
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  if (!engineJson(res.stdout))
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  console.log(`Voz ${req.name} clonada; pre-sintetizando sus anuncios…`);
  if (presynth({ voice: req.name, source: "flag" }, true) !== 0) {
    console.error(
      `La huella de la voz ${req.name} ya cambió, pero la pre-síntesis falló; ` +
        `reintenta con: narrate-ctl presynth --voice ${req.name} --force`,
    );
    return 1;
  }
  console.log(
    `Voz ${req.name} lista. Para usarla, fija /config → evolutivex-agents.voice = ${req.name}`,
  );
  return 0;
}

/**
 * `voice remove <nombre> --yes`: sin `--yes` sale con 2 sin invocar al motor;
 * con la versión mínima y el bloqueo, borra la voz y sus locuciones. El motor
 * protege las voces de fábrica.
 */
function voiceRemove(rest: string[]): number {
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

/** Borra la voz, informa sus locuciones y advierte si es la voz activa. */
function runRemove(cli: string, name: string): number {
  const res = runCli(
    cli,
    ["voice", "remove", "--name", name, "--yes", "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );
  const failure = engineFailure(res);
  if (failure) return reportFailure(failure);
  const removed = engineJson(res.stdout)?.removed_speech;
  if (!Array.isArray(removed))
    return reportFailure({ exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE });
  console.log(
    `Voz ${name} borrada; locuciones borradas: ${removed.length > 0 ? removed.join(", ") : "ninguna"}.`,
  );
  const active = readActiveVoice();
  if (active.source === "cache" && active.voice === name)
    console.log(
      `Aviso: ${name} es la voz activa según el último evento; la narración ` +
        "fallará hasta elegir otra en /config → evolutivex-agents.voice.",
    );
  return 0;
}

/** Familia `voice`: list, clone y remove. */
function runVoice([sub, ...rest]: string[]): number {
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
    "Uso: voice list | voice clone <nombre> (<ruta.wav> | --mic [--duration <segs>]) [--force] [--denoise] | voice remove <nombre> --yes",
  );
  return 2;
}

/** Parseo estricto de opciones; undefined si son inválidas. */
function parseOptions(
  rest: string[],
  options: NonNullable<Parameters<typeof parseArgs>[0]>["options"],
):
  | {
      values: Record<string, string | boolean | undefined>;
      positionals: string[];
    }
  | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options,
      allowPositionals: true,
      strict: true,
    });
    return {
      values: values as Record<string, string | boolean | undefined>,
      positionals,
    };
  } catch {
    return undefined;
  }
}

function runSay(rest: string[]): number {
  const parsed = parseOptions(rest, { voice: { type: "string" } });
  const text = parsed?.positionals.join(" ").trim();
  const voice = resolveVoice(parsed?.values.voice as string | undefined);
  if (!parsed || !text || !voice.voice) {
    console.error('Uso: say [--voice <nombre>] "<texto>"');
    return 2;
  }
  return say(text, voice);
}

function runPresynth(rest: string[]): number {
  const parsed = parseOptions(rest, {
    voice: { type: "string" },
    force: { type: "boolean", short: "f" },
  });
  const voice = resolveVoice(parsed?.values.voice as string | undefined);
  if (!parsed || parsed.positionals.length > 0 || !voice.voice) {
    console.error("Uso: presynth [--voice <nombre>] [--force]");
    return 2;
  }
  return presynth(voice, parsed.values.force === true);
}

function main(): number {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "status":
    case undefined:
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

// Nunca un stack trace: un error inesperado sale con 1 y un mensaje genérico.
let exitCode: number;
try {
  exitCode = main();
} catch {
  console.error("No se pudo completar la operación.");
  exitCode = 1;
}
process.exit(exitCode);
