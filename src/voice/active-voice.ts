// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Caché de la voz activa (`active-voice` en el state dir). La herramienta de
// shell no recibe las variables de /config, así que narrate-ctl no conoce la
// voz que eligió el usuario: los hooks (launcher y SessionStart) la escriben
// aquí en cada evento y narrate-ctl la lee cuando no recibe `--voice`. Es una
// caché derivada de /config, no una preferencia: el usuario no la edita y se
// reescribe desde /config en el siguiente evento.
import { readFileSync, writeFileSync } from "node:fs";
import { activeVoicePath, ensureStateDir } from "../lib/state-dir.js";
import { DEFAULT_VOICE } from "./voice.js";

export interface ActiveVoice {
  voice: string;
  /** `cache`: escrita por un hook; `default`: sin caché legible. */
  source: "cache" | "default";
}

/**
 * Escribe la voz activa solo si el contenido cambia, para no tocar el disco en
 * cada evento. Nunca lanza: un fallo de escritura se ignora.
 */
export function writeActiveVoice(voice: string): void {
  try {
    ensureStateDir();
    const path = activeVoicePath();
    if (readOrUndefined(path) === voice) return;
    writeFileSync(path, `${voice}\n`, "utf8");
  } catch {
    // La caché es best-effort: narrate-ctl cae a `default` y lo informa.
  }
}

/** Lee la voz de la caché, o `default` si falta, está vacía o es ilegible. */
export function readActiveVoice(): ActiveVoice {
  const voice = readOrUndefined(activeVoicePath());
  return voice
    ? { voice, source: "cache" }
    : { voice: DEFAULT_VOICE, source: "default" };
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
