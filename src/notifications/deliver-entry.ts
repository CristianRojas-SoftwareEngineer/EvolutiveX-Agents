// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Entrada interna `notification-deliver.js`: recibe una DeliveryRequest
// serializada en un único argumento JSON y la entrega con el núcleo. La lanza
// desanclada el despachador (hook y aviso de voz); no es la CLI pública.
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import { ensureStateDir } from "../lib/state-dir.js";
import {
  appendNotificationLog,
  deliver,
  parseDeliveryRequest,
} from "./delivery.js";
import { createDeliveryDeps } from "./delivery-runtime.js";

async function main(): Promise<number> {
  try {
    ensureStateDir();
  } catch {
    // Sin directorio de estado el log no escribe, pero la entrega sigue.
  }
  const request = parseDeliveryRequest(process.argv[2]);
  if (!request) {
    appendNotificationLog("invalid_request: argumento JSON ausente o inválido");
    return 1;
  }
  const result = await deliver(request, createDeliveryDeps());
  return result.ok ? 0 : 1;
}

if (
  typeof process.argv[1] === "string" &&
  ["notification-deliver.js", "deliver-entry.ts"].includes(
    basename(process.argv[1]),
  ) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().then(
    (code) => process.exit(code),
    () => process.exit(1),
  );
}
