// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Traduce el perfil de sonido del catálogo al valor que acepta node-notifier por SO.
import type { NotificationSoundProfile } from "./event-notification-profile.js";

/**
 * Tokens del catálogo (paridad BurntToast) → sonido WinRT que SnoreToast entiende.
 * node-notifier (`mapToWin8`) sustituye cualquier string sin prefijo `Notification.`
 * por `Notification.Default`; por eso cada token se traduce aquí a su nombre WinRT completo.
 * @see https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-audio
 */
const WIN32_NOTIFICATION_SOUND: Record<string, string> = {
  Default: "Notification.Default",
  IM: "Notification.IM",
  Reminder: "Notification.Reminder",
  SMS: "Notification.SMS",
  LoopingAlarm7: "Notification.Looping.Alarm7",
};

export function toWin32NotificationSound(token: string): string {
  if (token.startsWith("Notification.")) {
    return token;
  }
  return WIN32_NOTIFICATION_SOUND[token] ?? "Notification.Default";
}

export function resolveNotificationSound(
  profile: NotificationSoundProfile | undefined,
  platform: NodeJS.Platform,
): boolean | string {
  if (!profile) {
    return false;
  }
  if (platform === "win32") {
    const token = profile.win32;
    if (token === false || token === undefined) {
      return false;
    }
    return toWin32NotificationSound(token);
  }
  if (platform === "darwin") {
    const name = profile.darwin;
    if (name === false || name === undefined) {
      return false;
    }
    return name;
  }
  if (platform === "linux") {
    return profile.linux === true;
  }
  return false;
}
