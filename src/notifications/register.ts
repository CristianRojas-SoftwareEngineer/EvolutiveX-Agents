// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Helper de registro de AUMID (Application User Model ID) en Windows.
// Entry point CLI standalone, opt-in, idempotente.
import { Command } from "commander";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, resolve as resolvePath } from "node:path";
import { resolvePluginRoot } from "./event-image-paths.js";
import { readRegistry, writeRegistry, deleteRegistry } from "./registry.js";
import type { RegistryState } from "./registry.js";
import { parseIconLocation } from "./lnk-format.js";
import {
  SHORTCUT_ENGINE_SNORETOAST,
  getSnoreToastPath,
  installSnoreToastShortcut,
} from "./snoretoast-shortcut.js";

// Constantes del branding. `AUMID` sigue la convención Windows
// `[Compañía].[App]`, sin espacios, ≤ 129 caracteres.
export const AUMID = "EvolutiveX.Agents";
export const DISPLAY_NAME = "EvolutiveX Agents";
const LNK_FILENAME = "EvolutiveX-Agents.lnk";

export const registryProvider = {
  readRegistry,
  writeRegistry,
  deleteRegistry,
};

export const snoreToastProvider = {
  getSnoreToastPath,
  installSnoreToastShortcut,
};

// Resolver la ruta del `.lnk` en el Menú Inicio del usuario.
export function getLnkPath(): string {
  const appData = process.env["APPDATA"] ?? "";
  return join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    LNK_FILENAME,
  );
}

export function getIconIcoPath(): string {
  return join(
    resolvePluginRoot(),
    "assets",
    "notifications",
    "ai-assistant.ico",
  );
}

export function getIconPngPath(): string {
  return join(
    resolvePluginRoot(),
    "assets",
    "notifications",
    "ai-assistant.png",
  );
}

// Índice del frame 32×32 en `ai-assistant.ico` (orden: 0=16, 1=32, …, 5=256).
function buildIconLocation(icoPath: string): string {
  return `${icoPath},1`;
}

export type RegistrationStatus = "registered" | "partial" | "absent";

export interface RegistrationState {
  status: RegistrationStatus;
  lnkExists: boolean;
  lnkOk: boolean;
  registryOk: boolean;
  /** Lectura cruda del registro (`{ exists: false }` si no se pudo leer). */
  registry: RegistryState;
  /** Mensaje de error si la lectura del registro falló. */
  registryReadError?: string;
}

/**
 * Consulta el estado del registro AUMID y del `.lnk` sin escribir nada ni
 * producir salida. `absent`: ni registro ni `.lnk`; `registered`: ambos al día
 * con la carpeta del plugin en ejecución; `partial`: cualquier otro caso.
 */
export async function readRegistrationState(): Promise<RegistrationState> {
  const iconIcoPath = getIconIcoPath();
  const iconUriPath = getIconPngPath();
  let registry: RegistryState;
  let registryReadError: string | undefined;
  try {
    registry = await registryProvider.readRegistry(AUMID);
  } catch (err) {
    registry = { exists: false };
    registryReadError = (err as Error).message;
  }
  const lnkPath = getLnkPath();
  const lnkExists = existsSync(lnkPath);
  let lnkIconOk = false;
  if (lnkExists) {
    try {
      lnkIconOk =
        parseIconLocation(readFileSync(lnkPath)) ===
        buildIconLocation(iconIcoPath);
    } catch {
      lnkIconOk = false;
    }
  }
  const lnkOk =
    lnkIconOk && registry.shortcutEngine === SHORTCUT_ENGINE_SNORETOAST;
  const registryOk =
    registry.exists &&
    registry.displayName === DISPLAY_NAME &&
    registry.icon === iconIcoPath &&
    registry.iconUri === iconUriPath &&
    registry.shortcutEngine === SHORTCUT_ENGINE_SNORETOAST;
  const status: RegistrationStatus =
    !lnkExists && !registry.exists
      ? "absent"
      : registryOk && lnkOk
        ? "registered"
        : "partial";
  return {
    status,
    lnkExists,
    lnkOk,
    registryOk,
    registry,
    ...(registryReadError !== undefined ? { registryReadError } : {}),
  };
}

export type EnsureRegisteredResult =
  | { ok: true; changed: boolean }
  | { ok: false; step: "icon" | "registry" | "lnk"; error: string };

/**
 * Deja el registro AUMID y el `.lnk` en el estado esperado. Idempotente y sin
 * salida: devuelve si cambió algo, o el paso que falló. Nunca lanza.
 */
export async function ensureRegistered(): Promise<EnsureRegisteredResult> {
  const iconIcoPath = getIconIcoPath();
  const iconUriPath = getIconPngPath();

  if (!existsSync(iconIcoPath)) {
    return {
      ok: false,
      step: "icon",
      error: `Icono no encontrado en ${iconIcoPath}`,
    };
  }

  const state = await readRegistrationState();
  if (state.registryOk && state.lnkOk) return { ok: true, changed: false };

  // 1. Registro (efecto inmediato en UWP/SnoreToast).
  if (!state.registryOk) {
    try {
      await registryProvider.writeRegistry(
        AUMID,
        DISPLAY_NAME,
        iconIcoPath,
        iconUriPath,
      );
    } catch (err) {
      return { ok: false, step: "registry", error: (err as Error).message };
    }
  }

  // 2. .lnk vía SnoreToast (COM + ToastActivatorCLSID → shell:AppsFolder\<AUMID>).
  if (!state.lnkOk) {
    try {
      await snoreToastProvider.installSnoreToastShortcut(
        LNK_FILENAME,
        snoreToastProvider.getSnoreToastPath(),
        AUMID,
        getLnkPath(),
        buildIconLocation(iconIcoPath),
      );
    } catch (err) {
      return { ok: false, step: "lnk", error: (err as Error).message };
    }
  }
  return { ok: true, changed: true };
}

export async function installAction(): Promise<number> {
  const result = await ensureRegistered();
  if (!result.ok) {
    if (result.step === "icon") {
      process.stderr.write(`${result.error}. Aborta.
`);
    } else if (result.step === "registry") {
      process.stderr.write(`Error escribiendo registro: ${result.error}
`);
    } else {
      process.stderr.write(
        `Error creando .lnk con SnoreToast (registro sí se escribió): ${result.error}
`,
      );
    }
    return 1;
  }
  if (!result.changed) {
    process.stdout.write(
      `AUMID ya registrado (AppUserModelID="${AUMID}"): registro OK + .lnk OK. No-op.
`,
    );
    return 0;
  }
  process.stdout.write(
    `Registrado: AppUserModelID="${AUMID}" DisplayName="${DISPLAY_NAME}" (registro + .lnk SnoreToast=${getLnkPath()}, icono=${getIconIcoPath()}).
`,
  );
  return 0;
}

export async function uninstallAction(): Promise<number> {
  const lnkPath = getLnkPath();

  try {
    unlinkSync(lnkPath);
    process.stdout.write(`Eliminado .lnk: ${lnkPath}\n`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(
        `Error eliminando .lnk: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  try {
    await registryProvider.deleteRegistry(AUMID);
    process.stdout.write(`Eliminado registro: ${AUMID}\n`);
  } catch (err) {
    process.stderr.write(
      `Error eliminando registro: ${(err as Error).message}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `Reversión completa. SnoreToast volverá a firmar como "SnoreToast" hasta el próximo --install.\n`,
  );
  return 0;
}

export async function statusAction(): Promise<number> {
  const state = await readRegistrationState();
  if (state.registryReadError !== undefined) {
    process.stderr.write(
      `Error leyendo registro: ${state.registryReadError}\n`,
    );
  }
  const { registry } = state;
  if (state.status === "absent") {
    process.stdout.write(
      "not registered. Ejecuta `node dist/notification-register.js --install` para habilitar el branding en Windows\n",
    );
  } else if (state.status === "registered") {
    process.stdout.write(
      `registered: AppUserModelID="${AUMID}" DisplayName="${DISPLAY_NAME}" (registro + .lnk SnoreToast OK)\n`,
    );
  } else {
    const parts: string[] = [];
    parts.push(
      registry.exists
        ? `registro: DisplayName="${registry.displayName}" Icon="${registry.icon}" IconUri="${registry.iconUri ?? "(ausente)"}" ShortcutEngine="${registry.shortcutEngine ?? "(ausente)"}"`
        : "registro: no presente",
    );
    parts.push(state.lnkExists ? ".lnk: presente" : ".lnk: no presente");
    process.stdout.write(
      `partially registered (${parts.join("; ")}). Ejecuta --install para reparar.\n`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("notification-register")
    .description(
      "Registra, desregistra o consulta el AUMID de EvolutiveX Agents en Windows (idempotente, opt-in).",
    )
    .allowExcessArguments(false)
    .option(
      "--install",
      "Crea o actualiza el .lnk en el Menú Inicio y la clave de registro del AUMID",
    )
    .option("--uninstall", "Elimina el .lnk y la clave de registro del AUMID")
    .option(
      "--status",
      "Muestra el estado actual del registro (registro + .lnk)",
    )
    .parse(process.argv);

  const opts = program.opts<DispatchOpts>();
  return dispatch(opts);
}

export interface DispatchOpts {
  install?: boolean;
  uninstall?: boolean;
  status?: boolean;
}

export async function dispatch(
  opts: DispatchOpts,
  platform: NodeJS.Platform = process.platform,
): Promise<number> {
  if (platform !== "win32") {
    process.stdout.write(
      "AUMID setup is Windows-only. En macOS/Linux el branding se aplica via `appName` en node-notifier (sin registro).\n",
    );
    return 0;
  }

  if (opts.install) return installAction();
  if (opts.uninstall) return uninstallAction();
  if (opts.status) return statusAction();

  process.stderr.write("Especifica uno de: --install, --uninstall, --status\n");
  return 1;
}

// Auto-ejecutar solo cuando este módulo es el entry point (evita que
// `import` desde tests dispare `main()` + `process.exit()`).
const isEntryPoint =
  typeof process.argv[1] === "string" &&
  ["notification-register.js", "register.ts"].includes(
    basename(process.argv[1]),
  ) &&
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
