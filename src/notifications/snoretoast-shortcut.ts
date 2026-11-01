// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Instalación del acceso directo del AUMID vía SnoreToast `--install`.
//
// El .lnk binario MS-SHLLINK (lnk-format.ts) no basta: SnoreToast comprueba
// `shell:AppsFolder\<AUMID>` y, si falla, entra en "fallback mode" y el
// icono del header del toast queda como placeholder. El `--install` nativo
// crea el .lnk con IPropertyStore (AUMID + ToastActivatorCLSID) y registra
// el CLSID del activador en HKCU — requisito para branding correcto.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePluginRoot } from "./event-image-paths.js";
import { patchIconLocation } from "./lnk-format.js";

export const SHORTCUT_ENGINE_SNORETOAST = "snoretoast";

export function getSnoreToastPath(): string {
  const root = resolvePluginRoot();
  const suffix = process.arch === "x64" ? "64" : "86";
  const vendored = join(
    root,
    "vendor",
    "snoreToast",
    `snoretoast-x${suffix}.exe`,
  );
  if (existsSync(vendored)) {
    return vendored;
  }
  const fromNodeModules = join(
    root,
    "node_modules",
    "node-notifier",
    "vendor",
    "snoreToast",
    `snoretoast-x${suffix}.exe`,
  );
  if (existsSync(fromNodeModules)) {
    return fromNodeModules;
  }
  throw new Error(`SnoreToast no encontrado en ${vendored}`);
}

function execSnoreToast(args: string[]): Promise<void> {
  const snoreToast = getSnoreToastPath();
  return new Promise((resolve, reject) => {
    execFile(snoreToast, args, { windowsHide: true }, (err, stdout, stderr) => {
      const out = stdout == null ? "" : String(stdout);
      const errOut = stderr == null ? "" : String(stderr);
      if (err) {
        reject(Object.assign(err, { stdout: out, stderr: errOut }));
        return;
      }
      resolve();
    });
  });
}

/**
 * Crea el .lnk en el Menú Inicio con el flujo oficial de SnoreToast.
 * `lnkFileName` es solo el nombre (p. ej. `Agent-VoiceInterConnector.lnk`), no ruta absoluta.
 * `targetExe` suele ser la propia ruta de SnoreToast.
 */
export async function installSnoreToastShortcut(
  lnkFileName: string,
  targetExe: string,
  aumid: string,
  lnkAbsolutePath: string,
  iconLocation: string,
): Promise<void> {
  if (existsSync(lnkAbsolutePath)) {
    unlinkSync(lnkAbsolutePath);
  }
  await execSnoreToast(["-install", lnkFileName, targetExe, aumid]);

  // SnoreToast no asigna IconLocation: el header del toast hereda el icono
  // del .exe target (SnoreToast genérico). Fijamos el .ico del branding.
  const lnk = readFileSync(lnkAbsolutePath);
  const patched = patchIconLocation(lnk, iconLocation);
  writeFileSync(lnkAbsolutePath, patched);
}
