// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Núcleo de entrega de notificaciones: único lugar donde se entrega un toast.
// Lo usan la entrada interna `notification-deliver` (desanclada) y la CLI
// pública; el hook y el aviso de voz llegan a él por el despachador. Este
// módulo no importa node-notifier ni commander: el adaptador y el registro
// AUMID llegan como dependencias (ver delivery-runtime.ts), de modo que el
// despachador puede compartir la serialización sin arrastrar la entrega al
// bundle del hook.
import { appendRotatingLog } from "../lib/rotating-log.js";
import {
  ensureStateDir,
  notificationLogPath,
  rotatedNotificationLogPath,
} from "../lib/state-dir.js";
import type { NotificationService } from "./notification-service.js";
// Solo tipo: se borra al compilar y no arrastra register.ts al bundle del hook.
import type { EnsureRegisteredResult } from "./register.js";
import type { NotificationPayload } from "./types.js";

/** Solicitud de entrega: evento que la originó y notificación ya resuelta. */
export interface DeliveryRequest {
  event: string;
  payload: NotificationPayload;
}

export interface DeliveryResult {
  ok: boolean;
  /** Mensaje del error de entrega, si lo hubo. */
  error?: string;
  durationMs: number;
}

export interface DeliveryDeps {
  notifier: NotificationService;
  ensureRegistered: () => Promise<EnsureRegisteredResult>;
  now: () => number;
  platform: NodeJS.Platform;
  log: (message: string) => void;
}

/** Añade una línea a notification.log (rotación compartida con worker.log). */
export function appendNotificationLog(message: string): void {
  try {
    // El hook puede despachar antes de que exista el directorio de estado.
    ensureStateDir();
  } catch {
    // Sin directorio no hay log; el logging nunca lanza.
  }
  appendRotatingLog(
    {
      path: notificationLogPath(),
      rotatedPath: rotatedNotificationLogPath(),
      maxBytes: 512 * 1024,
      rotatedMaxAgeMs: 14 * 24 * 60 * 60 * 1000,
    },
    message,
  );
}

/** Serializa la solicitud como un único argumento JSON. */
export function serializeDeliveryRequest(request: DeliveryRequest): string {
  return JSON.stringify(request);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Valida la forma de una solicitud serializada. Devuelve una copia con solo
 * los campos conocidos, o undefined si el JSON o su forma no son válidos.
 */
export function parseDeliveryRequest(
  json: unknown,
): DeliveryRequest | undefined {
  if (typeof json !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { event, payload } = parsed as Record<string, unknown>;
  if (typeof event !== "string" || event === "") return undefined;
  if (payload === null || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.title !== "string" || typeof p.message !== "string")
    return undefined;
  if (
    p.sound !== undefined &&
    typeof p.sound !== "boolean" &&
    typeof p.sound !== "string"
  )
    return undefined;
  if (p.silent !== undefined && typeof p.silent !== "boolean") return undefined;
  if (!optionalString(p.appId) || !optionalString(p.icon)) return undefined;
  const clean: NotificationPayload = { title: p.title, message: p.message };
  if (p.sound !== undefined) clean.sound = p.sound;
  if (p.silent !== undefined) clean.silent = p.silent;
  if (p.appId !== undefined) clean.appId = p.appId;
  if (p.icon !== undefined) clean.icon = p.icon;
  return { event, payload: clean };
}

/** Una sola línea: sin saltos de línea y acotada. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Entrega la notificación y registra una línea por entrega. En Windows, y solo
 * en `SessionStart`, reconcilia antes el registro AUMID (apunta a la carpeta
 * versionada del plugin, que cambia con cada actualización). Nunca lanza.
 */
export async function deliver(
  request: DeliveryRequest,
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  const startedAt = deps.now();
  try {
    if (deps.platform === "win32" && request.event === "SessionStart") {
      try {
        const reg = await deps.ensureRegistered();
        if (!reg.ok) {
          deps.log(
            `aumid_reconcile_failed step=${reg.step} error="${oneLine(reg.error)}"`,
          );
        } else if (reg.changed) {
          deps.log("aumid_reconciled");
        }
      } catch (err) {
        deps.log(
          `aumid_reconcile_failed error="${oneLine((err as Error).message)}"`,
        );
      }
    }
    await deps.notifier.notify(request.payload);
    const durationMs = deps.now() - startedAt;
    deps.log(`event=${request.event} result=ok durationMs=${durationMs}`);
    return { ok: true, durationMs };
  } catch (err) {
    const durationMs = deps.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    try {
      deps.log(
        `event=${request.event} result=error durationMs=${durationMs} error="${oneLine(error)}"`,
      );
    } catch {
      // El log nunca debe impedir devolver el resultado.
    }
    return { ok: false, error, durationMs };
  }
}
