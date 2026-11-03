// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Nombre de presentación de la voz personalizada (`custom-display-name` en el
// state dir). En el motor y en /config la voz se llama siempre `custom`; este
// es el nombre propio que el usuario le dio al clonarla y solo se usa al
// mostrar la voz en narrate-ctl. La escribe `voice clone` tras un clonado
// correcto y la borra `voice remove custom`. Los hooks no la leen: perderla no
// afecta a la narración.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { customDisplayNamePath, ensureStateDir } from "../lib/state-dir.js";
import { normalizeDisplayName } from "./voice.js";

/** Guarda el nombre de forma atómica (temporal + rename). */
export function writeCustomDisplayName(name: string): void {
  ensureStateDir();
  const path = customDisplayNamePath();
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${name}\n`, "utf8");
  renameSync(tmpPath, path);
}

/** Nombre guardado, o undefined si falta o no es válido. */
export function readCustomDisplayName(): string | undefined {
  try {
    return normalizeDisplayName(readFileSync(customDisplayNamePath(), "utf8"));
  } catch {
    return undefined;
  }
}

/** Borra el nombre; no falla si no existe. */
export function removeCustomDisplayName(): void {
  rmSync(customDisplayNamePath(), { force: true });
}
