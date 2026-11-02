// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Cola FIFO de payloads de narración en disco. Cada hook escribe un archivo
// único y el worker drena en orden lexicográfico de nombre (timestamp
// monotónico + secuencia + pid + aleatorio, todos de ancho fijo), que equivale
// estrictamente al orden de llegada. Los archivos se borran al reclamarlos,
// por lo que la cola es persistente solo mientras hay eventos pendientes y
// no hay riesgo de narrar dos veces el mismo evento.
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ensureStateDir, queueDir } from "./state-dir.js";
import { parsePayload, type HookPayload } from "./hook-payload.js";

const MAX_PENDING = 64;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 h

let lastTimeMs = 0;
let seq = 0;

/**
 * Genera un nombre de archivo con segmentos de ancho fijo cuyo orden
 * lexicográfico coincide estrictamente con el orden de llegada (FIFO),
 * incluso ante múltiples inserciones dentro del mismo milisegundo o
 * retrocesos breves del reloj del sistema.
 */
function nextQueueFileName(): string {
  const now = Date.now();
  if (now > lastTimeMs) {
    lastTimeMs = now;
    seq = 0;
  } else {
    seq += 1;
    if (seq > 999_999) {
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

/** Escribe un payload en la cola de forma atómica (temporal + rename) y devuelve su ruta. */
export function enqueuePayload(payload: HookPayload): string {
  ensureStateDir();
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });
  const name = nextQueueFileName();
  const finalPath = join(dir, name);
  const tmpPath = join(dir, `.tmp-${name}`);
  writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
  renameSync(tmpPath, finalPath);
  return finalPath;
}

/** Lista los archivos de la cola ordenados por nombre (orden de llegada). */
export function listPending(): string[] {
  const dir = queueDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.startsWith(".tmp-"))
      .sort();
  } catch {
    return [];
  }
}

/** Reclama el primer elemento de la cola: lo lee y lo borra antes de narrar. */
export function claimNext():
  | {
      file: string;
      payload: HookPayload;
    }
  | undefined {
  const pending = listPending();
  if (pending.length === 0) return undefined;
  const file = join(queueDir(), pending[0]);
  let payload: HookPayload;
  try {
    payload = parsePayload(readFileSync(file, "utf8"));
  } catch {
    payload = {};
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // Si otro proceso lo borró, igual devolvemos el payload leído.
  }
  return { file, payload };
}

/** Poda la cola: elimina los más viejos si supera el tope y los expirados por TTL. */
export function pruneQueue(options: { max?: number; maxAgeMs?: number }): void {
  const max = options.max ?? MAX_PENDING;
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
  const pending = listPending();
  const now = Date.now();
  // Elimina expirados primero.
  for (const name of pending) {
    const file = join(queueDir(), name);
    try {
      const mt = statSync(file).mtimeMs;
      if (now - mt >= maxAgeMs) {
        rmSync(file, { force: true });
      }
    } catch {
      // Si no se puede leer el estado, lo dejamos; el próximo prune lo intentará de nuevo.
    }
  }
  // Si aún supera el tope, elimina los más viejos (ya están ordenados).
  const remaining = listPending();
  const excess = remaining.length - max;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) {
      try {
        rmSync(join(queueDir(), remaining[i]), { force: true });
      } catch {
        // Mejor esfuerzo.
      }
    }
  }
}

/** Elimina todos los archivos de la cola (usado por el worker al encontrar la narración desactivada). */
export function clearQueue(): void {
  try {
    for (const name of listPending()) {
      rmSync(join(queueDir(), name), { force: true });
    }
  } catch {
    // Mejor esfuerzo.
  }
}
