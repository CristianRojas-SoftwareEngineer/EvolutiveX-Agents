// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Diagnóstico del notificador del sistema para `narrate-ctl status`: comprueba
// en cada plataforma lo que la entrega realmente necesita. Windows: SnoreToast
// en vendor/ y el registro AUMID. macOS: terminal-notifier.app en vendor/.
// Linux: `notify-send` en el PATH (lo aporta el sistema, no el plugin).
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { resolvePluginRoot } from "./event-image-paths.js";
import { readRegistrationState } from "./register.js";
import type { RegistrationState } from "./register.js";

export interface NotifierDiagnostic {
  available: boolean;
  detail: string;
}

export interface NotifierDiagnosticDeps {
  pluginRoot: () => string;
  fileExists: (path: string) => boolean;
  /** Ruta del ejecutable en el PATH, o undefined si no está. */
  findOnPath: (command: string) => string | undefined;
  readRegistrationState: () => Promise<Pick<RegistrationState, "status">>;
  arch: string;
}

function defaultFindOnPath(command: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export const defaultNotifierDiagnosticDeps: NotifierDiagnosticDeps = {
  pluginRoot: () => resolvePluginRoot(),
  fileExists: existsSync,
  findOnPath: defaultFindOnPath,
  readRegistrationState,
  arch: process.arch,
};

export async function diagnoseNotifier(
  platform: NodeJS.Platform = process.platform,
  deps: NotifierDiagnosticDeps = defaultNotifierDiagnosticDeps,
): Promise<NotifierDiagnostic> {
  const vendor = join(deps.pluginRoot(), "vendor");
  if (platform === "win32") {
    const suffix = deps.arch === "x64" ? "64" : "86";
    const snoreToast = join(vendor, "snoreToast", `snoretoast-x${suffix}.exe`);
    if (!deps.fileExists(snoreToast)) {
      return { available: false, detail: `SnoreToast ausente: ${snoreToast}` };
    }
    let registro: string;
    try {
      registro = (await deps.readRegistrationState()).status;
    } catch {
      registro = "ilegible";
    }
    return {
      available: true,
      detail:
        registro === "registered"
          ? "SnoreToast presente; registro AUMID al día"
          : `SnoreToast presente; registro AUMID ${registro} (se reconcilia en el próximo SessionStart)`,
    };
  }
  if (platform === "darwin") {
    const app = join(
      vendor,
      "mac.noindex",
      "terminal-notifier.app",
      "Contents",
      "MacOS",
      "terminal-notifier",
    );
    return deps.fileExists(app)
      ? { available: true, detail: "terminal-notifier.app presente" }
      : { available: false, detail: `terminal-notifier ausente: ${app}` };
  }
  const found = deps.findOnPath("notify-send");
  return found !== undefined
    ? { available: true, detail: `notify-send en ${found}` }
    : {
        available: false,
        detail:
          "notify-send no está en el PATH; instala libnotify-bin (Debian/Ubuntu) o libnotify (Fedora/Arch)",
      };
}
