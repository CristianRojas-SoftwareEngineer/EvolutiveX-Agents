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
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.js";
import { stateDir } from "./lib/state-dir.js";
import { resolveCli, runCli } from "./voice/resolve-cli.js";
import { ANNOUNCEMENTS } from "./voice/message/static-announcements.js";
import { readActiveVoice } from "./voice/active-voice.js";
import { withVoiceOperationLock } from "./voice/operation-lock.js";
import { parseSingleJsonObject } from "./voice/health-decision.js";
import { normalizeVoiceName } from "./voice/voice.js";

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
      const code = typeof res.status === "number" ? res.status : null;
      const reason = reasonOf(res.stdout);
      if (!reportPresynth(eventKey, label, code, reason, force)) failed = true;
    }
    return failed ? 1 : 0;
  });
}

/** `reason` del envelope de error del motor, o undefined. */
function reasonOf(stdout: unknown): string | undefined {
  if (typeof stdout !== "string") return undefined;
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return undefined;
  const reason = (payload as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * Informa el resultado de pre-sintetizar un anuncio. Devuelve false si falló;
 * solo el exit `6` con `label_exists` cuenta como éxito idempotente.
 */
function reportPresynth(
  eventKey: string,
  label: string,
  code: number | null,
  reason: string | undefined,
  force: boolean,
): boolean {
  if (code === 0) {
    console.log(
      `${eventKey}: ${force ? "re-sintetizado" : "pre-sintetizado"} (${label})`,
    );
    return true;
  }
  if (code === 6 && reason === "label_exists") {
    console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    return true;
  }
  const hint =
    code === 5
      ? " — daemon caído; levántalo con `ai-voice-interconnector daemon start`"
      : code === 4
        ? " — modelo ausente; provisiónalo con `ai-voice-interconnector setup`"
        : "";
  const detail = code === null ? "no se pudo completar" : `exit ${code}`;
  console.error(
    `${eventKey}: fallo (${detail}${reason ? `, ${reason}` : ""})${hint}`,
  );
  return false;
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
