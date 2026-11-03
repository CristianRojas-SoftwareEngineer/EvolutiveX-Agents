// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Registro del último problema de voz (`voice-problem.json` en el state dir):
// el par {voice, reason} que el worker avisó con una notificación de escritorio
// o que calló por tener las notificaciones desactivadas. Lo escribe solo el
// worker, bajo su lock, y lo borra cualquier narración correcta. Sirve para
// avisar una sola vez por problema y volver a avisar si reaparece tras un
// arreglo.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ensureStateDir, voiceProblemPath } from "../lib/state-dir.js";

/** Razones del motor que dejan la narración muda hasta que el usuario actúe. */
const NOTIFIABLE_REASONS = [
  "voice_not_found",
  "speech_not_found",
  "invalid_identifier",
];

export type NarrationOutcome = { ok: true } | { ok: false; reason?: string };

interface VoiceProblem {
  voice: string;
  reason: string;
}

/** Problema registrado, o undefined si falta o es ilegible. */
function readProblem(): VoiceProblem | undefined {
  try {
    const data: unknown = JSON.parse(readFileSync(voiceProblemPath(), "utf8"));
    if (typeof data !== "object" || data === null) return undefined;
    const { voice, reason } = data as Record<string, unknown>;
    if (typeof voice !== "string" || typeof reason !== "string")
      return undefined;
    return { voice, reason };
  } catch {
    return undefined;
  }
}

/** Guarda el problema de forma atómica (temporal + rename). */
function writeProblem(problem: VoiceProblem): void {
  ensureStateDir();
  const path = voiceProblemPath();
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(problem)}\n`, "utf8");
  renameSync(tmpPath, path);
}

/**
 * Registra el resultado de una narración y devuelve true solo si hay que
 * avisar: un fallo con razón notificable distinto del último registrado. Un
 * éxito borra el registro; un fallo con otra razón no lo toca. Nunca lanza.
 */
export function trackVoiceProblem(
  voice: string,
  outcome: NarrationOutcome,
): boolean {
  try {
    if (outcome.ok) {
      rmSync(voiceProblemPath(), { force: true });
      return false;
    }
    const { reason } = outcome;
    if (reason === undefined || !NOTIFIABLE_REASONS.includes(reason))
      return false;
    const last = readProblem();
    if (last?.voice === voice && last.reason === reason) return false;
    writeProblem({ voice, reason });
    return true;
  } catch {
    return false;
  }
}
