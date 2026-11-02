// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// WORKER (proceso independiente del hook). Único consumidor de la cola FIFO en
// disco: reclama un evento, lo narra y lo borra antes de pasar al siguiente, así
// no hay solapamiento ni duplicación. Construye el mensaje y narra vía el CLI.
// Degrada en silencio; los errores van a worker.log.
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "./lib/config.js";
import { parseSingleJsonObject } from "./lib/health-decision.js";
import {
  ensureStateDir,
  workerLogPath,
  workerPidPath,
} from "./lib/state-dir.js";
import { claimNext, clearQueue, pruneQueue } from "./lib/queue.js";
import { resolveCli, runCliWithTimeout } from "./lib/resolve-cli.js";
import { isAlive } from "./lib/spawn.js";
import { buildMessage } from "./message/build-message.js";

function log(msg: string): void {
  try {
    appendFileSync(workerLogPath(), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // El logging nunca debe tumbar al worker.
  }
}

// Timeout de invocación CLI por tipo de narración.
const PLAY_TIMEOUT_MS = 10_000;
const SAY_TIMEOUT_MS = 45_000;
const KILL_GRACE_MS = 2_000;

/**
 * Pista por `reason` del payload de error de `speech play|say --json`
 * (contrato v0.41.1: toda salida ≠ 0 emite `{error, reason}` por stdout).
 * Un `reason` fuera de esta tabla se trata como ausente y el log conserva
 * solo el código, como exige la regla de consumo aditivo del motor.
 */
const REASON_HINTS: Record<string, string> = {
  speech_not_found: "locución no pre-sintetizada; ejecuta narrate-ctl presynth",
  voice_not_found:
    "voz no encontrada en el motor; ejecuta ai-voice-interconnector setup y luego narrate-ctl presynth",
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

/** Sufijo de diagnóstico ` (<reason>: <pista>)` o "" si el reason no es conocido. */
function failureDetail(stdout: string): string {
  const payload = parseSingleJsonObject(stdout);
  if (typeof payload !== "object" || payload === null) return "";
  const reason = (payload as Record<string, unknown>).reason;
  if (typeof reason !== "string" || !Object.hasOwn(REASON_HINTS, reason)) {
    return "";
  }
  return ` (${reason}: ${REASON_HINTS[reason]})`;
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
 * Ejecuta `speech play --label <label> --json` con timeout. Política de fallo:
 * cualquier exit ≠ 0 se registra en worker.log con su `reason` y su pista
 * cuando el envelope `--json` trae uno conocido (exit 3: `speech_not_found`,
 * `voice_not_found`, `no_output_device` o `audio_backend_unavailable`) y el
 * turno queda sin audio — sin re-sintetizado ni fallback a `speech say`.
 */
async function runPlay(cliPath: string, label: string): Promise<void> {
  const args = ["speech", "play", "--label", label, "--json"];
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs: PLAY_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS,
  });
  if (res.timedOut) {
    log(`speech play timeout tras ${PLAY_TIMEOUT_MS} ms; proceso terminado`);
    return;
  }
  if (res.code !== 0)
    log(`speech play salió con código ${res.code}${failureDetail(res.stdout)}`);
}

/**
 * Ejecuta `speech say --text <texto> --daemon --json` con timeout; un exit ≠ 0
 * se registra con su `reason` y su pista si es conocido.
 */
async function runSay(cliPath: string, text: string): Promise<void> {
  const args = ["speech", "say", "--text", text, "--daemon", "--json"];
  const res = await runCliWithTimeout(cliPath, args, {
    windowsHide: true,
    timeoutMs: SAY_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS,
  });
  if (res.timedOut) {
    log(`speech say timeout tras ${SAY_TIMEOUT_MS} ms; proceso terminado`);
    return;
  }
  if (res.code !== 0)
    log(`speech say salió con código ${res.code}${failureDetail(res.stdout)}`);
}

async function main(): Promise<void> {
  ensureStateDir();

  // Lock exclusivo: si otro worker ya drena, este sale y deja que él lo haga.
  if (!acquireLock()) return;

  try {
    // Podar cola expirada y sobrante antes de empezar.
    pruneQueue({ max: 64, maxAgeMs: 60 * 60 * 1000 });

    let lastActivity = Date.now();

    while (true) {
      const item = claimNext();
      if (!item) {
        // Nada pendiente: esperar un poco y reevaluar. Si pasa la ventana de
        // inactividad, salir.
        if (Date.now() - lastActivity > IDLE_MS) break;
        sleepSync(IDLE_POLL_MS);
        continue;
      }
      lastActivity = Date.now();

      const cfg = loadConfig();
      if (!cfg.voiceEnabled) {
        // Narración desactivada: descartar el resto de la cola y salir.
        clearQueue();
        return;
      }

      const request = await buildMessage(item.payload, cfg);
      if (request.kind === "say" && !request.text) {
        log("mensaje vacío tras la construcción; nada que narrar");
        continue;
      }

      const cli = resolveCli();
      if (!cli) {
        log(
          "ai-voice-interconnector no encontrado en PATH; se omite la narración",
        );
        continue;
      }

      if (request.kind === "play") await runPlay(cli, request.label);
      else await runSay(cli, request.text);

      // Hueco entre narraciones para que no suenen pegadas.
      if (NARRATION_GAP_MS > 0) sleepSync(NARRATION_GAP_MS);
    }
  } finally {
    releaseLock();
    process.exit(0);
  }
}

main().catch((err) => {
  log(`worker error: ${err?.message ?? err}`);
  process.exit(0);
});
