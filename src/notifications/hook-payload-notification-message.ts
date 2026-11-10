// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Mensaje dinámico del toast desde el payload JSON de hooks de Claude Code.

export const MAX_ASSISTANT_MESSAGE_LEN = 140;
export const MAX_TOOL_INPUT_PREVIEW_LEN = 120;

const STOP_FAILURE_ERROR_MAP: Record<string, string> = {
  rate_limit: "Límite de tasa (API)",
  authentication_failed: "Error de autenticación",
  billing_error: "Error de facturación o cuota",
  invalid_request: "Solicitud inválida",
  server_error: "Error del servidor",
  max_output_tokens: "Límite de tokens de salida",
  unknown: "Error de API desconocido",
};

// Firma de mojibake: bytes de continuación UTF-8 (0x80-0xBF) precedidos por un
// byte líder válido (2 bytes: C2-DF; 3 bytes: E0-EF), tal como aparecen cuando
// una cadena UTF-8 se decodifica erróneamente como Latin-1/CP1252.
const MOJIBAKE_SIGNATURE = /[Â-ß][\x80-¿]|[à-ï][\x80-¿]{2}/;

/**
 * Repara mojibake "UTF-8 leído como Latin-1" (p. ej. `Â¿quÃ©` → `¿qué`).
 *
 * Solo se repara si hay firma de mojibake y la re-decodificación no introduce
 * el carácter de reemplazo `U+FFFD` (señal de basura).
 */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE_SIGNATURE.test(text)) return text;
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  if (repaired.includes("\uFFFD")) return text;
  return repaired;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readStringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

export function formatStopFailureMessage(
  payload: Record<string, unknown>,
): string {
  const err = readStringField(payload, "error") ?? "unknown";
  let line1 = STOP_FAILURE_ERROR_MAP[err];
  if (!line1) line1 = `Error de API (${err})`;

  const detail = readStringField(payload, "last_assistant_message");
  if (detail) {
    return `${line1}\n${truncate(detail, MAX_ASSISTANT_MESSAGE_LEN)}`;
  }
  return line1;
}

function extractToolInputPreview(toolInput: unknown): string {
  if (toolInput == null) return "";

  if (typeof toolInput === "string") {
    return toolInput;
  }

  if (typeof toolInput === "object") {
    const obj = toolInput as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.file_path === "string") return obj.file_path;
    try {
      return JSON.stringify(toolInput);
    } catch {
      return "";
    }
  }

  return "";
}

export function formatPermissionRequestMessage(
  payload: Record<string, unknown>,
): string {
  const tool = readStringField(payload, "tool_name") ?? "Herramienta";
  let preview = extractToolInputPreview(payload.tool_input);

  if (preview) {
    preview = truncate(
      normalizeWhitespace(preview),
      MAX_TOOL_INPUT_PREVIEW_LEN,
    );
    return `Permiso para: ${tool}\n${preview}`;
  }
  return `Permiso para: ${tool}`;
}

interface QuestionItem {
  question?: string;
  header?: string;
}

export function formatPreToolUseAskMessage(
  payload: Record<string, unknown>,
): string | null {
  const toolInput = payload.tool_input;
  if (toolInput == null || typeof toolInput !== "object") return null;

  const ti = toolInput as { questions?: QuestionItem[] };
  const questions = ti.questions;
  if (!questions?.length) return null;

  const n = questions.length;
  const line1 = n === 1 ? "1 pregunta pendiente" : `${n} preguntas pendientes`;

  const first = questions[0];
  let preview = "";
  if (first?.question?.trim()) {
    preview = first.question.trim();
  } else if (first?.header?.trim()) {
    preview = first.header.trim();
  }

  if (preview) {
    preview = truncate(
      normalizeWhitespace(preview),
      MAX_TOOL_INPUT_PREVIEW_LEN,
    );
    return `${line1}\n${preview}`;
  }
  return line1;
}

export function formatUserPromptSubmitMessage(
  payload: Record<string, unknown>,
): string | null {
  const prompt = readStringField(payload, "prompt");
  if (!prompt) return null;
  return truncate(normalizeWhitespace(prompt), MAX_TOOL_INPUT_PREVIEW_LEN);
}

export function formatStopMessage(
  payload: Record<string, unknown>,
): string | null {
  const detail = readStringField(payload, "last_assistant_message");
  if (!detail) return null;
  return truncate(detail, MAX_ASSISTANT_MESSAGE_LEN);
}

/** PostToolUse de TaskUpdate: el asunto viaja en `tool_input.subject`. */
export function formatTaskInProgressMessage(
  payload: Record<string, unknown>,
): string | null {
  const toolInput = payload.tool_input;
  const subject =
    toolInput != null && typeof toolInput === "object"
      ? readStringField(toolInput as Record<string, unknown>, "subject")
      : undefined;
  if (!subject) return null;
  return `Tarea iniciada: ${truncate(normalizeWhitespace(subject), MAX_TOOL_INPUT_PREVIEW_LEN)}`;
}

/** TaskCreated y TaskCompleted: el asunto viaja en `task_subject` en la raíz. */
function formatTaskMessage(
  payload: Record<string, unknown>,
  prefix: string,
): string | null {
  const subject = readStringField(payload, "task_subject");
  return subject
    ? `${prefix}: ${truncate(normalizeWhitespace(subject), MAX_TOOL_INPUT_PREVIEW_LEN)}`
    : null;
}

type PayloadMessageFormatter = (
  payload: Record<string, unknown>,
) => string | null;

const HOOK_PAYLOAD_MESSAGE_FORMATTERS: Partial<
  Record<string, PayloadMessageFormatter>
> = {
  StopFailure: formatStopFailureMessage,
  PermissionRequest: formatPermissionRequestMessage,
  PreToolUse: formatPreToolUseAskMessage,
  UserPromptSubmit: formatUserPromptSubmitMessage,
  Stop: formatStopMessage,
  TaskInProgress: formatTaskInProgressMessage,
  TaskCreated: (payload) => formatTaskMessage(payload, "Tarea creada"),
  TaskCompleted: (payload) => formatTaskMessage(payload, "Tarea completada"),
};

/**
 * Deriva el cuerpo del toast desde el payload del hook.
 * Devuelve `null` si no hay formatter o el formatter no produce texto.
 */
export function resolveHookNotificationMessage(
  eventKey: string,
  payload: Record<string, unknown>,
): string | null {
  const formatter = HOOK_PAYLOAD_MESSAGE_FORMATTERS[eventKey];
  if (!formatter) return null;
  const result = formatter(payload);
  if (result == null || result.trim() === "") return null;
  return repairMojibake(result);
}
