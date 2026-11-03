// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Exclusión entre operaciones manuales de voz de narrate-ctl (`voice clone`,
// `voice remove`, `presynth`): el directorio `voice-operation.lock` del state
// dir, creado con `mkdir` exclusivo, con el PID del dueño en `owner`. Un PID
// vivo o un `owner` ausente o ilegible bloquean; un PID que ya no existe se
// retira y se reintenta una vez. El worker y los hooks nunca lo toman, así que
// la narración no espera nunca a una operación manual. Límites aceptados: un
// PID reutilizado por otro proceso bloquea de más (lado seguro) y se resuelve
// borrando el directorio a mano, como indica el mensaje.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureStateDir, voiceOperationLockPath } from "../lib/state-dir.js";
import { isAlive } from "./spawn.js";

/** Exit de narrate-ctl cuando otra operación de voz tiene el bloqueo. */
export const LOCK_BUSY_EXIT = 6;

// Reentrada desde el mismo proceso: `voice clone` reutiliza el bloqueo ya
// tomado para su pre-síntesis interna.
let depth = 0;

/**
 * Ejecuta `fn` con el bloqueo de operaciones manuales tomado y lo libera al
 * terminar, también ante una excepción. Si otra operación lo tiene, informa
 * por stderr y devuelve LOCK_BUSY_EXIT sin ejecutar `fn`.
 */
export function withVoiceOperationLock(fn: () => number): number {
  if (depth > 0) return runNested(fn);
  if (!acquire()) {
    console.error(
      "Hay otra operación de voz en curso; si no es así, borra " +
        `${voiceOperationLockPath()}.`,
    );
    return LOCK_BUSY_EXIT;
  }
  try {
    return runNested(fn);
  } finally {
    rmSync(voiceOperationLockPath(), { recursive: true, force: true });
  }
}

function runNested(fn: () => number): number {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}

/** Toma el bloqueo; con un dueño muerto lo retira y reintenta una vez. */
function acquire(): boolean {
  ensureStateDir();
  if (tryCreate()) return true;
  const owner = readOwner();
  if (owner === undefined || isAlive(owner)) return false;
  rmSync(voiceOperationLockPath(), { recursive: true, force: true });
  return tryCreate();
}

/** mkdir exclusivo del directorio y escritura del PID; false si ya existe. */
function tryCreate(): boolean {
  const dir = voiceOperationLockPath();
  try {
    mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  writeFileSync(join(dir, "owner"), String(process.pid), "utf8");
  return true;
}

/** PID del dueño, o undefined si `owner` falta o es ilegible. */
function readOwner(): number | undefined {
  try {
    const raw = readFileSync(join(voiceOperationLockPath(), "owner"), "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}
