// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// WORKER (proceso independiente del hook). Único consumidor de la cola FIFO en
// disco: reclama un evento, lo narra y lo borra antes de pasar al siguiente, así
// no hay solapamiento ni duplicación. Construye el mensaje y narra vía el CLI
// con la voz anotada en el ítem (siempre explícita con `--voice`). Los errores
// van a worker.log; si la voz falta, no tiene sus anuncios o su nombre es
// ilegal, además emite una notificación de escritorio con el remedio, una sola
// vez por problema (voice-problem.ts), sin pasar por el stdout de ningún hook.
import {
  appendFileSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.js";
import { parseSingleJsonObject } from "./health-decision.js";
import {
  ensureStateDir,
  rotatedWorkerLogPath,
  workerLogPath,
  workerPidPath,
} from "../lib/state-dir.js";
import { claimNext, clearQueue, pruneQueue } from "./queue.js";
import type { QueueItem } from "./queue.js";
import { resolveCli, runCliWithTimeout } from "./resolve-cli.js";
import { isAlive, spawnDetached } from "./spawn.js";
import { buildMessage } from "./message/build-message.js";
import { sayTimeoutMs } from "./say-timeout.js";
import { CUSTOM_VOICE } from "./voice.js";
import { trackVoiceProblem } from "./voice-problem.js";
import type { NarrationOutcome } from "./voice-problem.js";

// Cota de worker.log: al superar WORKER_LOG_MAX_BYTES se renombra a
// worker.log.1 (que reemplaza al anterior), y worker.log.1 se borra tras
// WORKER_LOG_ROTATED_MAX_AGE_MS sin modificarse. Como máximo, 2 archivos y
// 1 MiB en disco.
const WORKER_LOG_MAX_BYTES = 512 * 1024;
const WORKER_LOG_ROTATED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Rota worker.log antes de escribir. log() es su único escritor y corre bajo
 * el lock del worker, así que no hay carreras entre procesos.
 */
function rotateWorkerLog(): void {
  try {
    const rotated = rotatedWorkerLogPath();
    try {
      if (
        Date.now() - statSync(rotated).mtimeMs >
        WORKER_LOG_ROTATED_MAX_AGE_MS
      )
        rmSync(rotated, { force: true });
    } catch {
      // Sin worker.log.1: nada que caducar.
    }
    if (statSync(workerLogPath()).size > WORKER_LOG_MAX_BYTES)
      renameSync(workerLogPath(), rotated);
  } catch {
    // Sin worker.log o fallo al rotar: se escribe igual sobre el actual.
  }
}

function log(msg: string): void {
  rotateWorkerLog();
  try {
    appendFileSync(workerLogPath(), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // El logging nunca debe tumbar al worker.
  }
}

// Timeout de invocación CLI de `speech play`; el de `speech say` depende del
// texto (sayTimeoutMs).
const PLAY_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 2_000;

/**
 * Pista por `reason` del payload de error de `speech play|say --json`
 * (contrato del motor: toda salida ≠ 0 emite `{error, reason}` por stdout).
 * Las pistas que dependen de la voz son funciones de ella. Un `reason` fuera
 * de esta tabla se trata como ausente y el log conserva solo el código, como
 * exige la regla de consumo aditivo del motor.
 */
const REASON_HINTS: Record<string, string | ((voice: string) => string)> = {
  speech_not_found: (voice) =>
    `locución no pre-sintetizada para la voz ${voice}; ejecuta narrate-ctl presynth --voice ${voice}`,
  voice_not_found: (voice) =>
    voice === CUSTOM_VOICE
      ? "la voz custom todavía no está clonada; clónala con /evolutivex-agents:voice clone o elige otra en /config → evolutivex-agents.voice"
      : `la voz ${voice} no existe en el motor; elige otra en /config → evolutivex-agents.voice`,
  // `speech play` responde así a un nombre de voz ilegal (las etiquetas del
  // catálogo son fijas y válidas), p. ej. un valor antiguo en settings.json.
  invalid_identifier: (voice) =>
    `el nombre de voz «${voice}» no es válido; elige una voz en /config → evolutivex-agents.voice`,
  no_output_device:
    "sin dispositivo de salida de audio predeterminado; revisa ai-voice-interconnector devices",
  audio_backend_unavailable:
    "backend de audio del sistema no disponible (en Linux, ALSA/libasound.so.2)",
  playback_failed: "fallo de reproducción del audio",
  daemon_unreachable:
    "daemon caído; SessionStart lo levanta o ejecuta ai-voice-interconnector daemon start",
  model_missing:
    "modelo no provisionado; ejecuta ai-voice-interconnector setup",
};

/** Pista de un reason para la voz dada, o undefined si no es conocido. */
function reasonHint(reason: string, voice: string): string | undefined {
  if (!Object.hasOwn(REASON_HINTS, reason)) return undefined;
  const hint = REASON_HINTS[reason];
  return typeof hint === "function" ? hint(voice) : hint;
}

/** `reason` del envelope de error `--json`, o undefined si no lo trae. */
function failureReason(stdout: string): string | undefined {
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return undefined;
  const reason = (payload as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : undefined;
}

/** Sufijo de diagnóstico ` (<reason>: <pista>)` o "" si el reason no es conocido. */
function failureDetail(reason: string | undefined, voice: string): string {
  const hint = reason === undefined ? undefined : reasonHint(reason, voice);
  return hint === undefined ? "" : ` (${reason}: ${hint})`;
}

/**
 * Lanza desanclada una notificación de escritorio silenciosa con la pista,
 * vía dist/notification-cli.js (junto a este bundle). El CLI exige un
 * `--event-type`; `VoiceProblem` no está en su catálogo, así que usa el icono
 * genérico, y el título se fija con la marca.
 */
function notifyVoiceProblem(hint: string): void {
  const cliPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "notification-cli.js",
  );
  const message = hint.charAt(0).toUpperCase() + hint.slice(1);
  spawnDetached(process.execPath, [
    cliPath,
    "--event-type",
    "VoiceProblem",
    "--title",
    "EvolutiveX Agents",
    "--message",
    message,
    "--silent",
  ]);
}

// Pausa de respiración entre narraciones: evita que dos locuciones suenen pegadas.
const NARRATION_GAP_MS = 1_000;

// Ventana de inactividad antes de salir si la cola queda vacía.
const IDLE_MS = 5_000;
const IDLE_POLL_MS = 100;

/** Suspende el hilo actual de forma síncrona (sin event loop). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Intenta adquirir el lock exclusivo del worker mediante worker.pid. Devuelve true si lo consiguió. */
function acquireLock(): boolean {
  const pidPath = workerPidPath();
  try {
    writeFileSync(pidPath, String(process.pid), {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch {
    // Si worker.pid ya existe, verificar si pertenece a un proceso muerto (huérfano).
    try {
      const owner = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (Number.isInteger(owner) && isAlive(owner)) return false;
      rmSync(pidPath, { force: true });
      writeFileSync(pidPath, String(process.pid), {
        encoding: "utf8",
        flag: "wx",
      });
      return true;
    } catch {
      return false;
    }
  }
}

/** Libera el lock solo si aún somos nosotros el dueño. */
function releaseLock(): void {
  try {
    const owner = Number.parseInt(
      readFileSync(workerPidPath(), "utf8").trim(),
      10,
    );
    if (owner === process.pid) rmSync(workerPidPath(), { force: true });
  } catch {
    // Nada que liberar.
  }
}

/**
 * Ejecuta `speech play --label <label> --voice <voz> --json` con timeout y
 * devuelve el resultado. Política de fallo:
 * cualquier exit ≠ 0 se registra en worker.log con su `reason` y su pista
 * cuando el envelope `--json` trae uno conocido (exit 3: `speech_not_found`,
 * `voice_not_found`, `no_output_device` o `audio_backend_unavailable`) y el
 * turno queda sin audio — sin re-sintetizado ni fallback a `speech say`. Un
 * timeout cuenta como fallo sin razón.
 */
async function runPlay(
  cliPath: string,
  label: string,
  voice: string,
): Promise<NarrationOutcome> {
  const args = ["speech", "play", "--label", label, "--voice", voice, "--json"];
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs: PLAY_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS,
  });
  if (res.timedOut) {
    log(`speech play timeout tras ${PLAY_TIMEOUT_MS} ms; proceso terminado`);
    return { ok: false };
  }
  if (res.code === 0) return { ok: true };
  const reason = failureReason(res.stdout);
  log(
    `speech play salió con código ${res.code}${failureDetail(reason, voice)}`,
  );
  return { ok: false, reason };
}

/**
 * Ejecuta `speech say --text <texto> --voice <voz> --daemon --json` con
 * timeout y devuelve el resultado; un exit ≠ 0 se registra con su `reason` y
 * su pista si es conocido. Un timeout cuenta como fallo sin razón.
 */
async function runSay(
  cliPath: string,
  text: string,
  voice: string,
): Promise<NarrationOutcome> {
  const args = [
    "speech",
    "say",
    "--text",
    text,
    "--voice",
    voice,
    "--daemon",
    "--json",
  ];
  const timeoutMs = sayTimeoutMs(text);
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs,
    killGraceMs: KILL_GRACE_MS,
  });
  if (res.timedOut) {
    log(
      `speech say timeout tras ${timeoutMs} ms (${text.length} caracteres); proceso terminado`,
    );
    return { ok: false };
  }
  if (res.code === 0) return { ok: true };
  const reason = failureReason(res.stdout);
  log(`speech say salió con código ${res.code}${failureDetail(reason, voice)}`);
  return { ok: false, reason };
}

/**
 * Narra un ítem: construye el mensaje y lo reproduce o sintetiza vía el CLI
 * con la voz del ítem, y avisa por notificación si el resultado es un problema
 * de voz nuevo (y las notificaciones están activas). Devuelve false si la
 * narración está desactivada, tras descartar el resto de la cola.
 */
async function narrate({ payload, voice }: QueueItem): Promise<boolean> {
  const cfg = loadConfig();
  if (!cfg.voiceEnabled) {
    clearQueue();
    return false;
  }

  const request = await buildMessage(payload, cfg);
  if (request.kind === "say" && !request.text) {
    log("mensaje vacío tras la construcción; nada que narrar");
    return true;
  }

  const cli = resolveCli();
  if (!cli) {
    log("ai-voice-interconnector no encontrado en PATH; se omite la narración");
    return true;
  }

  const outcome =
    request.kind === "play"
      ? await runPlay(cli, request.label, voice)
      : await runSay(cli, request.text, voice);
  // trackVoiceProblem solo da true ante un fallo con razón notificable, y
  // todas tienen pista en REASON_HINTS.
  const isNewProblem = trackVoiceProblem(voice, outcome);
  if (isNewProblem && cfg.notificationsEnabled && !outcome.ok) {
    const hint = reasonHint(outcome.reason ?? "", voice);
    if (hint !== undefined) notifyVoiceProblem(hint);
  }

  // Hueco entre narraciones para que no suenen pegadas.
  if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);
  return true;
}

/**
 * Drena la cola en orden hasta pasar la ventana de inactividad sin trabajo,
 * o hasta encontrar la narración desactivada.
 */
async function drainQueue(): Promise<void> {
  let lastActivity = Date.now();
  while (true) {
    const item = claimNext();
    if (!item) {
      // Nada pendiente: esperar un poco y reevaluar. Si pasa la ventana de
      // inactividad, salir.
      if (Date.now() - lastActivity > IDLE_MS) return;
      sleepSync(IDLE_POLL_MS);
      continue;
    }
    lastActivity = Date.now();
    if (!(await narrate(item))) return;
  }
}

async function main(): Promise<void> {
  ensureStateDir();

  // Lock exclusivo: si otro worker ya drena, este sale y deja que él lo haga.
  if (!acquireLock()) return;

  try {
    // Podar cola expirada y sobrante antes de empezar.
    pruneQueue({ max: 64, maxAgeMs: 60 * 60 * 1000 });
    await drainQueue();
  } finally {
    releaseLock();
    process.exit(0);
  }
}

main().catch((err) => {
  log(`worker error: ${err?.message ?? err}`);
  process.exit(0);
});
