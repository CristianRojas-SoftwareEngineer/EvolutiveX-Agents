// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Utilidades compartidas por los tests: falsificar el SO, aislar variables de
// entorno y crear directorios temporales. Cada helper devuelve una función de
// restauración para no filtrar estado entre tests.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

/** Versión del motor verificada por el plugin (fuente única: package.json). */
export const ENGINE_VERSION: string = pkg.engine.aiVoiceInterConnector;

/**
 * Redefine process.platform (os.platform() lo refleja). Permite ejercitar las
 * tres ramas por SO de state-dir.ts y resolve-cli.ts en cualquier máquina.
 */
export function fakePlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(process, "platform", original);
  };
}

/** Fija (o borra, con undefined) variables de entorno y permite restaurarlas. */
export function withEnv(vars: Record<string, string | undefined>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function makeTempDir(prefix = "avi-plugin-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Reintentos de removeDir: hasta ~6 s en total.
const REMOVE_RETRIES = 40;
const REMOVE_RETRY_DELAY_MS = 150;
const RETRYABLE_REMOVE_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

export function removeDir(dir: string): void {
  // En Windows, un hijo desanclado o un nieto sobreviviente de un spawnSync
  // con timeout (p. ej. el shim que demora en doctor) puede retener handles
  // del temporal, y rmSync lanza EPERM mientras termina. El reintento es
  // propio porque el rmSync nativo de Node 24 ignora maxRetries ante EPERM.
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (attempt >= REMOVE_RETRIES || !RETRYABLE_REMOVE_CODES.has(code))
        throw err;
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        REMOVE_RETRY_DELAY_MS,
      );
    }
  }
}

/**
 * Espera a que un predicado sea verdadero, consultando cada 50 ms hasta el
 * timeout. Devuelve el valor final del predicado. Sirve para observar efectos
 * asíncronos de un hijo desanclado (p. ej. el append a argv.log de daemon
 * start), que en Windows puede tardar cientos de milisegundos.
 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/**
 * Aísla el state dir del plugin en un directorio temporal: falsifica Linux y
 * apunta XDG_STATE_HOME al temporal, de modo que un test nunca toque el
 * state dir real de la máquina, sea cual sea el SO anfitrión.
 */
export function isolateStateDir(): { dir: string; restore: () => void } {
  const dir = makeTempDir();
  const restorePlatform = fakePlatform("linux");
  const restoreEnv = withEnv({
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });
  return {
    dir,
    restore: () => {
      restoreEnv();
      restorePlatform();
      removeDir(dir);
    },
  };
}
