// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Modelo del JSON que Claude Code entrega por stdin a cada hook. Solo se tipan
// los campos que el plugin consume; el resto se ignora.
export interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  transcript_path?: string;
  /** Presente en Stop / SubagentStop / StopFailure: último mensaje del asistente. */
  last_assistant_message?: string;
  /** Presente en Notification: aviso ya redactado y corto. */
  message?: string;
  /** Presente en UserPromptSubmit: la petición actual del usuario (fiable). */
  prompt?: string;
  /** Presente en eventos de herramientas (PreToolUse, PostToolUse, PermissionRequest). */
  tool_name?: string;
  /** Argumentos de la herramienta invocada en eventos de herramientas. */
  tool_input?: unknown;
  /** Código de error en StopFailure (p. ej. rate_limit, server_error). */
  error?: string;
  /** Título nativo de la tarea en TaskCreated y TaskCompleted. */
  task_subject?: string;
  /** Fallback de asunto de tarea cuando se envía en nivel raíz. */
  subject?: string;
}

/** Parseo tolerante: nunca lanza; ante entrada inválida devuelve un objeto vacío. */
export function parsePayload(raw: string): HookPayload {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as HookPayload;
  } catch {
    // Entrada vacía o malformada.
  }
  return {};
}

/** Lee stdin completo como texto. Resuelve con "" si no hay entrada. */
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const stdin = process.stdin;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    stdin.on("data", (c: Buffer) => chunks.push(c));
    stdin.on("end", done);
    stdin.on("error", done);
    stdin.on("close", done);
  });
}
