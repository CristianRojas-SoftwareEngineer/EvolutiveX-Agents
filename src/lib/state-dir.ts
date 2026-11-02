// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// State dir por convención de cada SO. Equivalente en miniatura al data_root()
// de AI Voice-InterConnector, sin depender de él. Contiene config.json (solo
// preferencias no secretas), worker.pid, queue/ (cola de payloads de narración)
// y worker.log. La API key se lee del entorno y no se guarda aquí.
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

export function configPath(): string {
  return join(stateDir(), "config.json");
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
