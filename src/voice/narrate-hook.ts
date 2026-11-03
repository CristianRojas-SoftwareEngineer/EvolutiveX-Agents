// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// LAUNCHER (fire-and-forget). Corre DENTRO del hook de Claude Code: lee el
// payload, decide si narrar, lo encola y lanza el worker desanclado solo si
// no hay uno vivo drenando. Debe salir en <100 ms — nada de red, síntesis ni
// espera. Sirve a los cinco hooks que narran (Stop, SubagentStop, StopFailure,
// UserPromptSubmit, Notification); el worker distingue el evento por
// hook_event_name.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { workerPidPath } from "../lib/state-dir.js";
import { clearQueue, enqueuePayload } from "./queue.js";
import { isAlive, spawnDetached } from "./spawn.js";
import { readStdin, parsePayload } from "../lib/hook-payload.js";

async function main(): Promise<void> {
  const raw = await readStdin();

  // Voz desactivada en /config: se vacía la cola para que el worker en curso
  // calle tras el ítem actual, y se sale sin encolar ni lanzar el worker.
  const cfg = loadConfig();
  if (!cfg.voiceEnabled) {
    clearQueue();
    return;
  }

  const payload = parsePayload(raw);

  // Encolar el payload para el worker (traspaso launcher → worker).
  enqueuePayload(payload);

  // Lanzar el worker desanclado solo si no hay uno vivo drenando la cola.
  const owner = readOwnerPid();
  if (!Number.isInteger(owner) || !isAlive(owner)) {
    const here = dirname(fileURLToPath(import.meta.url));
    const worker = join(here, "narrate-worker.js");
    spawnDetached(process.execPath, [worker]);
  }
}

/** Lee el PID dueño actual de la plaza, o NaN si no hay archivo. */
function readOwnerPid(): number {
  try {
    return Number.parseInt(readFileSync(workerPidPath(), "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}

// El launcher nunca falla la sesión: cualquier error se traga y sale 0.
main()
  .catch(() => {})
  .finally(() => process.exit(0));
