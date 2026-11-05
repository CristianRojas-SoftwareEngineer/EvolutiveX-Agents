// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Puerto del servicio de notificaciones de escritorio.
// Sin imports de infraestructura: no node-notifier, no fs, no os, no path.
import type { NotificationPayload } from "./types.js";

/**
 * Contrato mínimo del servicio: un único método `notify`.
 * Hay dos implementaciones: la entrega en el mismo proceso
 * (`DesktopNotificationAdapter`, delega en `node-notifier` y espera al
 * backend) y el despacho desanclado (`DetachedNotificationDispatcher`, lanza
 * `notification-deliver.js` sin esperar). Este puerto permanece agnóstico del
 * canal.
 */
export interface NotificationService {
  notify(payload: NotificationPayload): Promise<void> | void;
}
