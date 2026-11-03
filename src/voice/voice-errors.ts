// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Interpretación pura de los resultados del motor en las operaciones de voz de
// narrate-ctl (§9 de docs/specs/VOICE_CLONING.md): el exit da la clase del
// error y el `reason` del envelope `--json` su causa fina. Un `reason`
// desconocido conserva el exit con un mensaje genérico; un hijo no iniciado,
// terminado por señal o con timeout es un fallo del plugin (exit 1), igual que
// un JSON inválido del motor.
import { parseSingleJsonObject } from "./health-decision.js";

export const NOT_COMPLETED_MESSAGE = "No se pudo completar la operación.";
export const UNEXPECTED_RESPONSE_MESSAGE =
  "El motor devolvió una respuesta inesperada.";

const AUDIO_HINT = "Usa un WAV válido de hasta 30 s; se recomiendan ~10 s.";
const DEVICE_HINT =
  "No hay micrófono predeterminado o falta el backend de audio: revisa `ai-voice-interconnector devices`.";
const DENOISE_HINT = "Comprueba la instalación y el modelo de limpieza.";

/** Mensaje orientativo por `reason` del motor. */
const REASON_MESSAGES: Record<string, string> = {
  invalid_voice_name: "Usa letras, números, punto, guion o guion bajo.",
  audio_not_found: "La ruta de referencia no existe.",
  invalid_audio: AUDIO_HINT,
  empty_audio: AUDIO_HINT,
  audio_too_long: AUDIO_HINT,
  no_input_device: DEVICE_HINT,
  audio_backend_unavailable: DEVICE_HINT,
  transcription_failed:
    "No se pudo capturar audio: revisa los permisos del micrófono o usa un WAV.",
  voice_exists: "Elige otro nombre o usa `--force` para reemplazarla.",
  denoise_busy: "Reintenta al terminar la limpieza en curso.",
  denoise_unsupported: DENOISE_HINT,
  denoise_failed: DENOISE_HINT,
  model_missing: "Ejecuta `ai-voice-interconnector setup`.",
  daemon_unreachable:
    "Levanta el daemon con `ai-voice-interconnector daemon start`.",
  voice_clone_failed: "El clonado falló; el mensaje del motor indica su log.",
  cannot_remove_default: "Las voces de fábrica no se pueden borrar.",
  voice_not_found: "Consulta `voice list` y elige una voz existente.",
  lifecycle_locked: "Espera a que termine la instalación o limpieza del motor.",
};

/** Resultado de una invocación síncrona del motor (subconjunto de spawnSync). */
export interface EngineRun {
  status: number | null;
  error?: unknown;
  stdout: unknown;
}

/** Fallo interpretado: exit de narrate-ctl y mensaje para el usuario. */
export interface EngineFailure {
  exitCode: number;
  message: string;
}

/** Objeto JSON único de stdout, o undefined si no lo hay. */
export function engineJson(
  stdout: unknown,
): Record<string, unknown> | undefined {
  if (typeof stdout !== "string") return undefined;
  const payload = parseSingleJsonObject(stdout);
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : undefined;
}

/** Fallo de la invocación, o undefined si el motor terminó con exit 0. */
export function engineFailure(run: EngineRun): EngineFailure | undefined {
  if (run.error || run.status === null)
    return { exitCode: 1, message: NOT_COMPLETED_MESSAGE };
  if (run.status === 0) return undefined;
  const payload = engineJson(run.stdout);
  if (!payload) return { exitCode: 1, message: UNEXPECTED_RESPONSE_MESSAGE };
  return { exitCode: run.status, message: failureMessage(run.status, payload) };
}

function failureMessage(
  status: number,
  payload: Record<string, unknown>,
): string {
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const hint = Object.hasOwn(REASON_MESSAGES, reason)
    ? REASON_MESSAGES[reason]
    : `El motor falló con exit ${status}${reason ? ` (${reason})` : ""}.`;
  const error = typeof payload.error === "string" ? payload.error : "";
  return error ? `${error}\n${hint}` : hint;
}
