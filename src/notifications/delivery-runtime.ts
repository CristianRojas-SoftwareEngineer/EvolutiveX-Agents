// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Dependencias reales del núcleo de entrega: node-notifier, el registro AUMID
// y el log. Solo lo importan los bundles que entregan (notification-deliver y
// notification-cli); el hook y el worker de voz no.
import { DesktopNotificationAdapter } from "./desktop-notification-adapter.js";
import { appendNotificationLog } from "./delivery.js";
import type { DeliveryDeps } from "./delivery.js";
import { ensureRegistered } from "./register.js";

export function createDeliveryDeps(): DeliveryDeps {
  return {
    notifier: new DesktopNotificationAdapter(),
    ensureRegistered,
    now: () => Date.now(),
    platform: process.platform,
    log: appendNotificationLog,
  };
}
