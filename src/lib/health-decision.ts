// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Decisión pura del hook de SessionStart contra el contrato v0.36.2 de
// `doctor --json` (DOCTOR.md del tag del motor): el comando emite exactamente
// un objeto JSON con `failed: string[]` y `checks: {name, ok, detail}[]`, y el
// veredicto sale del exit más el reporte válido —nunca de un campo `status`
// que el motor no emite. Concentra el tipo del reporte, el parser de un único
// objeto completo y el criterio, de modo que main() quede como cableado
// delgado y la lógica sea verificable en aislado. Sin efectos ni I/O.

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  failed: string[];
  checks: DoctorCheck[];
  models?: { missing?: string[] };
}

/**
 * Veredicto discriminado del health-check: diagnóstico sano (única rama que
 * puede requerir calentar el daemon), aviso al usuario con mensaje acotado, o
 * estado incierto (sin daemon ni remedio inventado).
 */
export type HealthDecision =
  | { kind: "healthy" }
  | { kind: "notify"; message: string }
  | { kind: "uncertain" };

/** Aviso base por entorno de voz no provisionado. Fuente única. */
export const NOT_PROVISIONED_MESSAGE =
  "Agent Voice-InterConnector: el entorno de voz no está provisionado. Ejecuta " +
  "ai-voice-interconnector setup para habilitar la narración por voz.";

/** Aviso cuando `doctor` falla como comando (reason doctor_failed). */
const DOCTOR_FAILED_MESSAGE =
  "Agent Voice-InterConnector: el diagnóstico del motor (doctor) falló y no produjo " +
  "un veredicto. Ejecuta ai-voice-interconnector doctor --json manualmente.";

const DOCTOR_JSON_HINT =
  "Ejecuta ai-voice-interconnector doctor --json para el detalle.";

/**
 * Extrae el ÚNICO objeto JSON de la salida y lo parsea. El motor emite
 * exactamente un objeto: cualquier contenido tras su cierre (p. ej. un objeto
 * concatenado) convierte la salida en inválida y devuelve undefined, en lugar
 * de extraer el primer objeto. También devuelve undefined si el texto no
 * empieza por un objeto o el fragmento no parsea.
 */
export function parseSingleJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (trimmed.slice(i + 1).trim() !== "") return undefined;
        try {
          return JSON.parse(trimmed.slice(0, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** ¿El valor parseado tiene el shape mínimo del reporte v0.36.2? */
function isValidReport(value: unknown): value is DoctorReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.failed) ||
    !record.failed.every((f) => typeof f === "string")
  ) {
    return false;
  }
  if (!Array.isArray(record.checks)) return false;
  for (const check of record.checks) {
    if (typeof check !== "object" || check === null) return false;
    const c = check as Record<string, unknown>;
    if (
      typeof c.name !== "string" ||
      typeof c.ok !== "boolean" ||
      typeof c.detail !== "string"
    ) {
      return false;
    }
  }
  if (record.models !== undefined) {
    if (typeof record.models !== "object" || record.models === null) {
      return false;
    }
    const models = record.models as Record<string, unknown>;
    if (
      models.missing !== undefined &&
      (!Array.isArray(models.missing) ||
        !models.missing.every((m) => typeof m === "string"))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Mensaje único de aviso con TODOS los checks fallidos, sin ocultar ninguno.
 * `models_provisioned` es el único con mensaje de `setup` (incluye
 * `models.missing` si es array de cadenas); el resto muestra nombre/detalle y
 * remite a `doctor --json`. Los checks desconocidos se nombran sin remedio
 * inventado.
 */
function buildFailedMessage(report: DoctorReport): string {
  const parts = report.failed.map((name) => {
    const check = report.checks.find((c) => c.name === name);
    if (name === "models_provisioned") {
      const missing = Array.isArray(report.models?.missing)
        ? report.models.missing.filter(
            (m): m is string => typeof m === "string",
          )
        : [];
      const missingNote =
        missing.length > 0
          ? ` Modelos sin provisionar: ${missing.join(", ")}.`
          : "";
      return `${name}: ${NOT_PROVISIONED_MESSAGE}${missingNote}`;
    }
    const detail = check ? check.detail : "";
    return detail ? `${name}: ${detail}.` : `${name}.`;
  });
  return (
    "Agent Voice-InterConnector: el diagnóstico del motor reporta chequeos " +
    `fallidos. ${parts.join(" ")} ${DOCTOR_JSON_HINT}`
  );
}

/**
 * Decisión pura y total del health-check sobre exit + reporte. Cuatro filas:
 * (exit 0 + reporte válido + failed vacío) → sano; (exit 1 + reporte válido +
 * failed no vacío) → aviso por cada check fallido; (exit 1 + objeto de error
 * `doctor_failed`) → aviso de fallo del diagnóstico; cualquier otra
 * combinación (exit incoherente, shape inválido, JSON malformado, timeout o
 * error de ejecución) → incierto, sin daemon ni remedio inventado.
 */
export function decideHealthAction(input: {
  exitCode: number | null;
  report: unknown;
}): HealthDecision {
  const { exitCode, report } = input;
  if (isValidReport(report)) {
    if (exitCode === 0 && report.failed.length === 0) {
      return { kind: "healthy" };
    }
    if (exitCode === 1 && report.failed.length > 0) {
      return { kind: "notify", message: buildFailedMessage(report) };
    }
    return { kind: "uncertain" };
  }
  if (
    exitCode === 1 &&
    typeof report === "object" &&
    report !== null &&
    (report as Record<string, unknown>).reason === "doctor_failed"
  ) {
    return { kind: "notify", message: DOCTOR_FAILED_MESSAGE };
  }
  return { kind: "uncertain" };
}
