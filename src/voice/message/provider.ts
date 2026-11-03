// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Utilidades del proveedor único de texto (Gemini): contrato de entrada y
// contenido del mensaje. La degradación local vive fuera de esta capa, en
// build-message.
import { SUMMARY_CLOSING } from "./prompts.js";

export interface GenerationInput {
  /** Único material del turno: `last_assistant_message` ya acotado por clampHead. */
  text: string;
}

/** Timeout por request; una locución que llega tarde ya no es conversacional. */
export const REQUEST_TIMEOUT_MS = 8000;
export const MAX_OUTPUT_TOKENS = 512;

/**
 * Construye el contenido del ÚNICO mensaje `user` para el proveedor LLM:
 * el material del turno más el cierre no presuntivo. Sin historial ni mapeo
 * de roles: el LLM nunca recibe nada que no sea el `last_assistant_message`
 * del payload.
 */
export function buildUserContent(input: GenerationInput): string {
  const text = (input.text ?? "").trim();
  return `Material del turno:\n\n${text}\n\n${SUMMARY_CLOSING}`;
}
