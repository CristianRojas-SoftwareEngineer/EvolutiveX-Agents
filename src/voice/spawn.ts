// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Desanclaje y terminación de procesos. El desanclaje es multiplataforma con una
// sola API; la terminación del árbol es la única bifurcación por SO del plugin.
import { spawn, spawnSync } from "node:child_process";

/**
 * Lanza `cmd args` como proceso desanclado: nuevo process group (POSIX) /
 * consola propia (Windows), sin heredar stdio, sin ventana en Windows. El
 * llamante puede salir de inmediato (unref). Devuelve el PID o undefined.
 */
export function spawnDetached(cmd: string, args: string[]): number | undefined {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

/** ¿El proceso con ese PID sigue vivo? Señal 0 no envía nada, solo comprueba. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: existe pero no tenemos permiso → sigue vivo.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Opciones para la terminación de un árbol de procesos.
 */
export interface KillProcessTreeOpts {
  /** Tiempo de gracia en ms tras SIGTERM antes de enviar SIGKILL (POSIX). */
  killGraceMs?: number;
}

/**
 * Mata el árbol de procesos de un PID. Windows: taskkill /T /F. POSIX:
 * envía SIGTERM al grupo de procesos, espera la gracia y envía SIGKILL si
 * persiste. Idempotente y silenciosa: si el PID ya no existe, no hace nada.
 */
export function killProcessTree(
  pid: number,
  opts: KillProcessTreeOpts = {},
): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const graceMs = opts.killGraceMs ?? 2000;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    // El PID es el líder de su grupo de procesos (spawn con detached: true).
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ya no existe el grupo, o no tenemos permiso: nada que hacer.
  }
  if (graceMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, graceMs);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Ya terminó o no tenemos permiso.
  }
}
