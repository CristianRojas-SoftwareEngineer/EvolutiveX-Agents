// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Construcción de la notificación a partir de opciones y payload de hook.
// Sin commander ni adaptador: la usan el hook (decisión), la CLI pública y el
// aviso de problemas de voz.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NotificationPayload } from "./types.js";
import {
  getProfileForEvent,
  NOTIFICATION_BRAND_TITLE,
} from "./event-notification-profile.js";
import {
  resolveEventImagePath,
  resolvePluginRoot,
} from "./event-image-paths.js";
import { resolveHookNotificationMessage } from "./hook-payload-notification-message.js";
import { resolveNotificationSound } from "./resolve-notification-sound.js";

// Default de branding: AUMID Windows (Company.App, sin espacios, ≤ 129 chars).
export const DEFAULT_APP_ID = "EvolutiveX.Agents";

export const globalFallbackIconProvider = {
  get(): string {
    return join(
      resolvePluginRoot(),
      "assets",
      "notifications",
      "ai-assistant.png",
    );
  },
};

export function resolveGlobalFallbackIconPath(): string | undefined {
  const p = globalFallbackIconProvider.get();
  return existsSync(p) ? p : undefined;
}

export interface CliOptions {
  eventType?: string;
  message?: string;
  title?: string;
  sound: boolean;
  silent: boolean;
  stdinJson: boolean;
  appId?: string;
  icon?: string;
}

/** Quita BOM UTF-8 y espacios (común en stdin de hooks en Windows / PowerShell). */
export function normalizeStdinJsonText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

export function resolveEventKey(
  options: CliOptions,
  stdinPayload?: Record<string, unknown>,
): string | undefined {
  if (options.eventType) {
    return options.eventType;
  }
  if (options.stdinJson && stdinPayload) {
    const name = stdinPayload["hook_event_name"];
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }
  return undefined;
}

/**
 * Resuelve branding: `appId` por defecto; `icon` según override, perfil del
 * evento o fallback global `ai-assistant.png`.
 */
export function resolveBranding(
  options: CliOptions,
  eventKey?: string,
): { appId: string; icon?: string } {
  const appId = options.appId ?? DEFAULT_APP_ID;
  if (options.icon !== undefined) {
    return { appId, icon: options.icon };
  }
  const key = eventKey ?? options.eventType;
  if (key) {
    const profile = getProfileForEvent(key);
    if (profile) {
      const eventIcon = resolveEventImagePath(profile.image);
      if (eventIcon) {
        return { appId, icon: eventIcon };
      }
    }
  }
  const fallback = resolveGlobalFallbackIconPath();
  if (fallback) {
    return { appId, icon: fallback };
  }
  return { appId };
}

export function resolveEventSound(
  options: CliOptions,
  eventKey?: string,
  platform: NodeJS.Platform = process.platform,
): boolean | string {
  if (options.silent) {
    return false;
  }
  if (options.sound) {
    return true;
  }
  const profile = eventKey ? getProfileForEvent(eventKey) : undefined;
  return resolveNotificationSound(profile?.sound, platform);
}

/** Título: override CLI → nombre del hook (eventKey) → marca por defecto. */
export function resolveNotificationTitle(
  options: CliOptions,
  eventKey?: string,
): string {
  if (options.title !== undefined && options.title !== "") {
    return options.title;
  }
  if (eventKey) {
    return eventKey;
  }
  return NOTIFICATION_BRAND_TITLE;
}

/** Mensaje: override CLI → formatter stdin → catálogo. */
export function resolveNotificationMessage(
  options: CliOptions,
  eventKey: string | undefined,
  stdinPayload?: Record<string, unknown>,
): string | undefined {
  if (options.message !== undefined && options.message !== "") {
    return options.message;
  }
  if (options.stdinJson && stdinPayload && eventKey) {
    const dynamic = resolveHookNotificationMessage(eventKey, stdinPayload);
    if (dynamic) return dynamic;
  }
  if (eventKey) {
    return getProfileForEvent(eventKey)?.message;
  }
  return undefined;
}

export function buildNotificationPayload(
  options: CliOptions,
  stdinPayload?: Record<string, unknown>,
  platform: NodeJS.Platform = process.platform,
): NotificationPayload | { error: string } {
  if (options.stdinJson && !stdinPayload) {
    return { error: "No se recibió payload por stdin con --stdin-json" };
  }

  const eventKey = resolveEventKey(options, stdinPayload);

  if (!options.stdinJson && !options.eventType) {
    return { error: "Falta --event-type (o usa --stdin-json con payload)" };
  }

  const title = resolveNotificationTitle(options, eventKey);
  const message = resolveNotificationMessage(options, eventKey, stdinPayload);

  if (message === undefined || message === "") {
    return {
      error:
        "Falta mensaje: usa --message, --event-type con perfil en catálogo, o --stdin-json con formatter aplicable",
    };
  }
  const branding = resolveBranding(options, eventKey);
  return {
    title,
    message,
    sound: resolveEventSound(options, eventKey, platform),
    silent: options.silent,
    appId: branding.appId,
    ...(branding.icon !== undefined ? { icon: branding.icon } : {}),
  };
}
