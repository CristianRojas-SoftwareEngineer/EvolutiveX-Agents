// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Adaptador concreto que delega en node-notifier.
// IMPORTANTE: `node-notifier` v10 usa la clave `appID` (con "ID" en
// mayúsculas) en su `allowedToasterFlags` (lib/utils.js). Si pasamos
// `appId` (camelCase), `node-notifier` lo ignora silenciosamente y
// SnoreToast recibe su AUMID por defecto "SnoreToast". La traducción
// a `appID` ocurre aquí para preservar la API pública idiomática
// (`appId` camelCase) sin acoplar el dominio al quirk de `node-notifier`.
import notifier from "node-notifier";
import type { INotificationService } from "./INotificationService.js";
import type { NotificationEvent } from "./types.js";

export interface NodeNotifierOptions {
  title: string;
  message: string;
  sound?: boolean | string;
  wait: false;
  appID?: string;
  icon?: string;
}

export type NotifyCallback = (err: Error | null) => void;
export type NotifyFn = (
  options: NodeNotifierOptions,
  cb: NotifyCallback,
) => void;

export class DesktopNotificationAdapter implements INotificationService {
  private readonly notifyFn: NotifyFn;

  constructor(notifyFn?: NotifyFn) {
    this.notifyFn =
      notifyFn ??
      ((options, cb) => {
        notifier.notify(options, (err) => cb(err ?? null));
      });
  }

  /**
   * Traduce `silent: true` a `sound: false` para silenciar el toast.
   * Copia `appId` (dominio, camelCase) → `appID` (node-notifier, con
   * mayúsculas) SOLO si está presente en el evento (degradación con
   * gracia). Copia `icon` con el mismo criterio. Cualquier otro campo
   * del evento se ignora intencionalmente.
   */
  notify(event: NotificationEvent): Promise<void> {
    const options: NodeNotifierOptions = {
      title: event.title,
      message: event.message,
      sound: event.silent === true ? false : (event.sound ?? false),
      wait: false,
    };
    if (event.appId !== undefined) options.appID = event.appId;
    if (event.icon !== undefined) options.icon = event.icon;
    return new Promise<void>((resolve, reject) => {
      this.notifyFn(options, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
