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
import { parseIconLocation } from "./lnk-format.js";
import {
  SHORTCUT_ENGINE_SNORETOAST,
  getSnoreToastPath,
  installSnoreToastShortcut,
} from "./snoretoast-shortcut.js";

// Constantes del branding. `AUMID` sigue la convención Windows
// `[Compañía].[App]`, sin espacios, ≤ 129 caracteres.
export const AUMID = "Agent.VoiceInterConnector";
export const DISPLAY_NAME = "Agent-VoiceInterConnector";
const LNK_FILENAME = `${DISPLAY_NAME}.lnk`;

// Validación defensiva del AUMID (override por env `AI_ASSISTANT_AUMID`).
const AUMID_REGEX = /^[A-Za-z0-9.-]{1,129}$/;

export const registryProvider = {
  readRegistry,
  writeRegistry,
  deleteRegistry,
};

export const snoreToastProvider = {
  getSnoreToastPath,
  installSnoreToastShortcut,
};

function getAumid(): string {
  return process.env["AI_ASSISTANT_AUMID"] ?? AUMID;
}

export function isValidAumid(value: string): boolean {
  return AUMID_REGEX.test(value);
}

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

interface InstallState {
  lnkOk: boolean;
  registryOk: boolean;
}

async function checkInstallState(
  aumid: string,
  iconIcoPath: string,
  iconUriPath: string,
): Promise<InstallState> {
  const registry = await registryProvider.readRegistry(aumid);
  const lnkPath = getLnkPath();
  let lnkIconOk = false;
  if (existsSync(lnkPath)) {
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
  return { lnkOk, registryOk };
}

export async function installAction(): Promise<number> {
  const aumid = getAumid();
  if (!isValidAumid(aumid)) {
    process.stderr.write(
      `AUMID inválido: "${aumid}". Debe coincidir con /^[A-Za-z0-9.\\-]{1,129}$/\n`,
    );
    return 1;
  }
  const lnkPath = getLnkPath();
  const iconIcoPath = getIconIcoPath();
  const iconUriPath = getIconPngPath();

  if (!existsSync(iconIcoPath)) {
    process.stderr.write(`Icono no encontrado en ${iconIcoPath}. Aborta.\n`);
    return 1;
  }

  const state = await checkInstallState(aumid, iconIcoPath, iconUriPath);
  const needsRegistry = !state.registryOk;
  const needsLnk = !state.lnkOk;

  // Idempotencia: no-op solo si registro y .lnk están al día.
  if (!needsRegistry && !needsLnk) {
    process.stdout.write(
      `AUMID ya registrado (AppUserModelID="${aumid}"): registro OK + .lnk OK. No-op.\n`,
    );
    return 0;
  }

  // 1. Registro (efecto inmediato en UWP/SnoreToast).
  if (needsRegistry) {
    try {
      await registryProvider.writeRegistry(
        aumid,
        DISPLAY_NAME,
        iconIcoPath,
        iconUriPath,
      );
    } catch (err) {
      process.stderr.write(
        `Error escribiendo registro: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  // 2. .lnk vía SnoreToast (COM + ToastActivatorCLSID → shell:AppsFolder\<AUMID>).
  if (needsLnk) {
    try {
      const snoreToast = snoreToastProvider.getSnoreToastPath();
      await snoreToastProvider.installSnoreToastShortcut(
        LNK_FILENAME,
        snoreToast,
        aumid,
        lnkPath,
        buildIconLocation(iconIcoPath),
      );
    } catch (err) {
      process.stderr.write(
        `Error creando .lnk con SnoreToast (registro sí se escribió): ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  process.stdout.write(
    `Registrado: AppUserModelID="${aumid}" DisplayName="${DISPLAY_NAME}" (registro + .lnk SnoreToast=${lnkPath}, icono=${iconIcoPath}).\n`,
  );
  return 0;
}

export async function uninstallAction(): Promise<number> {
  const aumid = getAumid();
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
    await registryProvider.deleteRegistry(aumid);
    process.stdout.write(`Eliminado registro: ${aumid}\n`);
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
  const aumid = getAumid();
  const lnkPath = getLnkPath();
  const iconIcoPath = getIconIcoPath();

  const lnkExists = existsSync(lnkPath);

  let registry;
  try {
    registry = await registryProvider.readRegistry(aumid);
  } catch (err) {
    process.stderr.write(`Error leyendo registro: ${(err as Error).message}\n`);
    registry = { exists: false };
  }

  if (!lnkExists && !registry.exists) {
    process.stdout.write(
      "not registered. Ejecuta `node dist/notification-register.js --install` para habilitar el branding en Windows\n",
    );
  } else if (
    registry.exists &&
    registry.displayName === DISPLAY_NAME &&
    registry.icon === iconIcoPath &&
    registry.iconUri === getIconPngPath() &&
    registry.shortcutEngine === SHORTCUT_ENGINE_SNORETOAST &&
    lnkExists &&
    parseIconLocation(readFileSync(lnkPath)) === buildIconLocation(iconIcoPath)
  ) {
    process.stdout.write(
      `registered: AppUserModelID="${aumid}" DisplayName="${DISPLAY_NAME}" (registro + .lnk SnoreToast OK)\n`,
    );
  } else {
    const parts: string[] = [];
    parts.push(
      registry.exists
        ? `registro: DisplayName="${registry.displayName}" Icon="${registry.icon}" IconUri="${registry.iconUri ?? "(ausente)"}" ShortcutEngine="${registry.shortcutEngine ?? "(ausente)"}"`
        : "registro: no presente",
    );
    parts.push(lnkExists ? ".lnk: presente" : ".lnk: no presente");
    process.stdout.write(
      `partially registered (${parts.join("; ")}). Ejecuta --install para reparar.\n`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("notifications-register")
    .description(
      "Registra, desregistra o consulta el AUMID de Agent-VoiceInterConnector en Windows (idempotente, opt-in).",
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
