// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// System prompt y cierre para la única ruta de generación dinámica (`Stop`).
// El LLM recibe únicamente `last_assistant_message` (ni transcript ni
// historial), así que el contrato es anti-invención: narrar solo lo presente.
// Contrato común impuesto al modelo y verificado luego por sanitize.ts: texto
// plano, español, 1-2 frases, primera persona, sin markdown ni símbolos.

export const SUMMARY_SYSTEM_PROMPT =
  "Eres un desarrollador que habla por voz sintetizada en tiempo real. " +
  "Narra en primera persona, en una o dos frases breves en español, únicamente " +
  "lo que muestra el material de este turno. Si el turno fue una conversación " +
  "breve, un saludo o una respuesta sin cambios técnicos, nárralo con " +
  "naturalidad como tal. No inventes trabajo, comandos, rutas ni identificadores " +
  "que no aparezcan explícitos. Conserva los identificadores y rutas que sí " +
  "estén presentes cuando aporten claridad. Texto plano, sin markdown ni símbolos.";

/** Cierre no presuntivo que se anexa al material del turno (no presupone trabajo). */
export const SUMMARY_CLOSING =
  "Cuéntamelo en voz alta en primera persona, de forma fiel a lo que ocurrió en este turno.";
