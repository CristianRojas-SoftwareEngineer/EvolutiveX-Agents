// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Despachador desanclado: implementa el puerto NotificationService lanzando
// `notification-deliver.js` (junto a este bundle) como proceso desanclado y
// sin esperar a la entrega. Es la única forma de despachar un toast desde el
// plugin: así el hook termina en milisegundos aunque el backend del SO tarde
// (SnoreToast espera a que el toast expire o se descarte).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDetached } from "../lib/process.js";
import { appendNotificationLog, serializeDeliveryRequest } from "./delivery.js";
import type { NotificationService } from "./notification-service.js";
import type { NotificationPayload } from "./types.js";

export type SpawnDetachedFn = (
  cmd: string,
  args: string[],
) => number | undefined;

export interface DispatcherOptions {
  /** Lanzador de procesos desanclados; se inyecta en los tests. */
  spawn?: SpawnDetachedFn;
  /** Registro de despachos fallidos; se inyecta en los tests. */
  log?: (message: string) => void;
}

/** Ruta de la entrada de entrega, hermana de este bundle; nunca configurable. */
function deliverEntryPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "notification-deliver.js",
  );
}

export class DetachedNotificationDispatcher implements NotificationService {
  private readonly spawn: SpawnDetachedFn;
  private readonly log: (message: string) => void;

  constructor(
    private readonly event: string,
    options: DispatcherOptions = {},
  ) {
    this.spawn = options.spawn ?? spawnDetached;
    this.log = options.log ?? appendNotificationLog;
  }

  notify(payload: NotificationPayload): void {
    let pid: number | undefined;
    let reason = "sin PID";
    try {
      pid = this.spawn(process.execPath, [
        deliverEntryPath(),
        serializeDeliveryRequest({ event: this.event, payload }),
      ]);
    } catch (err) {
      reason = (err as Error).message;
    }
    if (pid === undefined) {
      this.log(`event=${this.event} result=dispatch_failed error="${reason}"`);
    }
  }
}
