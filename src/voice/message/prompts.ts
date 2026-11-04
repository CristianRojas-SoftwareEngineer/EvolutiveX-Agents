// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// System prompt y cierre para la única ruta de generación dinámica (`Stop`).
// El LLM recibe únicamente `last_assistant_message` (ni transcript ni
// historial) y lo parafrasea como la voz del asistente: dice el mensaje
// condensado, con su misma persona, tono e intención, en lugar de relatar lo
// que el asistente hizo («Hola, ¿qué tal?» y no «Te he saludado»). El contrato
// es anti-invención: solo lo presente en el mensaje. Contrato común impuesto al
// modelo y verificado luego por sanitize.ts: texto plano, español, 1-2 frases,
// sin markdown ni símbolos.

export const SUMMARY_SYSTEM_PROMPT =
  "Eres la voz del asistente. Di en voz alta, en una o dos frases breves en " +
  "español, una versión condensada de su mensaje, como si tú mismo se lo " +
  "estuvieras diciendo al usuario. Parafrasea el mensaje; no lo describas ni lo " +
  'relates desde fuera: di "Hola, ¿qué tal?" y no "Te he saludado y te he ' +
  'preguntado qué tal". Mantén la persona, el tono y la intención del original: ' +
  "si pregunta, pregunta; si informa, informa. No inventes trabajo, comandos, " +
  "rutas ni identificadores que no aparezcan explícitos. Conserva los " +
  "identificadores y rutas presentes cuando aporten claridad. Texto plano, sin " +
  "markdown ni símbolos.";

/** Cierre que se anexa al mensaje del asistente: pide parafrasearlo, no relatarlo. */
export const SUMMARY_CLOSING =
  "Dilo en voz alta, parafraseado y condensado, como si fuera tu propio mensaje.";
