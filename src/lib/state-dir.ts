// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// State dir por convención de cada SO. Equivalente en miniatura al data_root()
// de AI Voice-InterConnector, sin depender de él. Contiene worker.pid (el lock
// del worker), queue/ (cola de payloads de narración), worker.log y su
// rotación worker.log.1, active-voice (caché de la voz activa que escriben los
// hooks para narrate-ctl), custom-display-name (nombre de presentación de la
// voz personalizada) y voice-operation.lock (exclusión entre operaciones
// manuales de voz). Las preferencias viven en el userConfig del plugin y la
// API key en el entorno: ninguna se guarda aquí.
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const APP_DIR = "evolutivex-agents";

/** Directorio de estado del plugin, según el SO. No garantiza que exista. */
export function stateDir(): string {
  const home = homedir();
  switch (platform()) {
    case "win32": {
      const base = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
      return join(base, APP_DIR);
    }
    case "darwin":
      return join(home, "Library", "Application Support", APP_DIR);
    default: {
      const base = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");
      return join(base, APP_DIR);
    }
  }
}

/** Crea el state dir si no existe y devuelve su ruta. */
export function ensureStateDir(): string {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function workerPidPath(): string {
  return join(stateDir(), "worker.pid");
}

export function queueDir(): string {
  return join(stateDir(), "queue");
}

export function workerLogPath(): string {
  return join(stateDir(), "worker.log");
}

/** Generación anterior de worker.log, tras su rotación por tamaño. */
export function rotatedWorkerLogPath(): string {
  return join(stateDir(), "worker.log.1");
}

/** Caché de la voz activa: derivada de /config, no es una preferencia. */
export function activeVoicePath(): string {
  return join(stateDir(), "active-voice");
}

/** Etiqueta de presentación de la voz `custom`, escrita por `voice clone`. */
export function customDisplayNamePath(): string {
  return join(stateDir(), "custom-display-name");
}

/** Directorio de exclusión entre operaciones manuales de voz. */
export function voiceOperationLockPath(): string {
  return join(stateDir(), "voice-operation.lock");
}
