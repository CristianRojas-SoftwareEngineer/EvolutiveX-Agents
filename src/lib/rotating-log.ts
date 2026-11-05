// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Log de texto con rotación acotada, compartido por worker.log y
// notification.log. Al superar `maxBytes` el archivo actual se renombra al
// rotado (que reemplaza al anterior), y el rotado se borra tras
// `rotatedMaxAgeMs` sin modificarse: como máximo dos archivos en disco.
import { appendFileSync, renameSync, rmSync, statSync } from "node:fs";

export interface RotatingLogOptions {
  path: string;
  rotatedPath: string;
  maxBytes: number;
  rotatedMaxAgeMs: number;
}

/**
 * Rota si hace falta y añade `<ISO> <message>`. Nunca lanza: el logging no
 * debe tumbar a quien lo usa. Sin bloqueo entre procesos: cada log tiene un
 * escritor serializado por su proceso o por un lock del llamante.
 */
export function appendRotatingLog(
  { path, rotatedPath, maxBytes, rotatedMaxAgeMs }: RotatingLogOptions,
  message: string,
): void {
  try {
    try {
      if (Date.now() - statSync(rotatedPath).mtimeMs > rotatedMaxAgeMs)
        rmSync(rotatedPath, { force: true });
    } catch {
      // Sin archivo rotado: nada que caducar.
    }
    if (statSync(path).size > maxBytes) renameSync(path, rotatedPath);
  } catch {
    // Sin log actual o fallo al rotar: se escribe igual sobre el actual.
  }
  try {
    appendFileSync(
      path,
      `${new Date().toISOString()} ${message}
`,
    );
  } catch {
    // El logging nunca debe lanzar.
  }
}
