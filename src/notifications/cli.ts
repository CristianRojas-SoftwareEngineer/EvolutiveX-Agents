// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Entry point CLI standalone. Delega en DesktopNotificationAdapter.
import { Command, Option } from "commander";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath, basename, join } from "node:path";
import { readStdin } from "../lib/hook-payload.js";
import { DesktopNotificationAdapter } from "./desktop-notification-adapter.js";
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

const SOUND_FLAG = "sound";
const SILENT_FLAG = "silent";
const STDIN_JSON_FLAG = "stdin-json";
const APP_ID_FLAG = "app-id";
const ICON_FLAG = "icon";

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

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("notification-cli")
    .description("Emite un toast nativo del SO desde un hook de Claude Code")
    .option("--event-type <type>", "Tipo de evento del lifecycle (p. ej. Stop)")
    .option(
      "--message <msg>",
      "Cuerpo del toast (override; por defecto catálogo o formatter stdin)",
    )
    .option(
      "--title <title>",
      "Título del toast (override; por defecto nombre del hook)",
    )
    .addOption(
      new Option(`--${SOUND_FLAG}`, "Reproducir sonido genérico").conflicts(
        SILENT_FLAG,
      ),
    )
    .addOption(
      new Option(`--${SILENT_FLAG}`, "Silenciar el toast").conflicts(
        SOUND_FLAG,
      ),
    )
    .option(
      `--${STDIN_JSON_FLAG}`,
      "Leer payload JSON por stdin y derivar mensaje dinámico",
    )
    .option(
      `--${APP_ID_FLAG} <id>`,
      `Identificador de aplicación (AUMID Windows); default: ${DEFAULT_APP_ID}`,
    )
    .option(
      `--${ICON_FLAG} <path>`,
      "Ruta al icono de la notificación; default: perfil del evento o ai-assistant.png",
    )
    .allowExcessArguments(false)
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  options.sound = Boolean(options.sound);
  options.silent = Boolean(options.silent);
  options.stdinJson = Boolean(options.stdinJson);

  let stdinPayload: Record<string, unknown> | undefined;
  if (options.stdinJson) {
    let raw: string;
    try {
      raw = await readStdin();
    } catch (err) {
      process.stderr.write(`Error leyendo stdin: ${(err as Error).message}\n`);
      return 1;
    }
    try {
      const parsed: unknown = JSON.parse(normalizeStdinJsonText(raw));
      if (typeof parsed !== "object" || parsed === null) {
        process.stderr.write(
          "Payload de stdin inválido: no es un objeto JSON\n",
        );
        return 1;
      }
      stdinPayload = parsed as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(
        `Payload de stdin no parseable como JSON: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  const built = buildNotificationPayload(options, stdinPayload);
  if ("error" in built) {
    process.stderr.write(`${built.error}\n`);
    return 1;
  }

  const adapter = new DesktopNotificationAdapter();
  try {
    await adapter.notify(built);
    return 0;
  } catch (err) {
    process.stderr.write(
      `Error emitiendo notificación: ${(err as Error).message}\n`,
    );
    return 1;
  }
}

// Auto-ejecutar solo cuando este módulo es el entry point (evita que
// `import` desde tests dispare `main()` + `process.exit()`).
const isEntryPoint =
  typeof process.argv[1] === "string" &&
  ["notification-cli.js", "cli.ts"].includes(basename(process.argv[1])) &&
  fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);

if (isEntryPoint) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`Error inesperado: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
