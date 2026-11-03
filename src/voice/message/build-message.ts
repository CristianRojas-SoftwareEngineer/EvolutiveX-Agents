// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Orquestador del subsistema de mensajes: payload → petición de narración
// (`say` con texto dinámico o `play` de un anuncio pre-sintetizado). Siempre
// resuelve (nunca lanza). Flujo MVP determinista: solo `Stop` (y el default
// para evento desconocido/ausente) genera locución dinámica, y el LLM recibe
// ÚNICAMENTE `last_assistant_message` — ni transcript ni historial. El resto de
// eventos (`Notification`, `SubagentStop`, `StopFailure`, `UserPromptSubmit`)
// reproduce su anuncio pre-sintetizado (`play`), sin LLM ni síntesis por evento.
// Degradación de la ruta `Stop`: Gemini (input acotado con clampHead) →
// resumen local determinista → anuncio estático por evento. Las dos locuciones
// dinámicas pasan por `clampSentences`: hasta `SPEECH_MAX_SENTENCES` oraciones,
// con `SPEECH_MAX_CHARS` como freno de emergencia. Único proveedor, sin fallback
// de proveedor: cualquier fallo de Gemini cae directamente al resumen local.
// El sano descarta el cuerpo de los bloques de código cercados, así que una
// respuesta que solo sea código no entra en ninguna ruta dinámica.
import type { Config } from "../../lib/config.js";
import type { HookPayload } from "../../lib/hook-payload.js";
import type { GenerationInput } from "./provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import {
  ANNOUNCEMENTS,
  type NarrationRequest,
} from "./static-announcements.js";
import { sanitizeForSpeech } from "./sanitize.js";
import {
  clampHead,
  clampSentences,
  SPEECH_MAX_CHARS,
  SPEECH_MAX_SENTENCES,
} from "./clamp.js";

/** Punto de entrada del subsistema. Devuelve la petición de narración para el worker. */
export async function buildMessage(
  payload: HookPayload,
  cfg: Config,
): Promise<NarrationRequest> {
  const event = payload.hook_event_name;

  // Eventos con anuncio fijo pre-sintetizado: sin LLM ni síntesis por evento.
  if (event === "Notification") {
    return { kind: "play", label: ANNOUNCEMENTS.Notification.label };
  }
  if (event === "UserPromptSubmit") {
    return { kind: "play", label: ANNOUNCEMENTS.UserPromptSubmit.label };
  }
  if (event === "SubagentStop") {
    return { kind: "play", label: ANNOUNCEMENTS.SubagentStop.label };
  }
  if (event === "StopFailure") {
    return { kind: "play", label: ANNOUNCEMENTS.StopFailure.label };
  }

  // Ruta Stop (y default para evento desconocido/ausente): única ruta dinámica.
  const raw = payload.last_assistant_message ?? "";
  const primary = sanitizeForSpeech(raw);

  // Umbral: sin material narrable no se invoca el LLM. Una respuesta sin prosa
  // —porque solo contenía bloques de código cercados, que el saneo descarta— cae
  // aquí y degrada al anuncio estático del evento. En este punto el evento solo
  // puede ser `Stop` (los demás retornaron arriba) o desconocido/ausente.
  if (primary === "") {
    const fallback =
      event === "Stop" ? ANNOUNCEMENTS.Stop : ANNOUNCEMENTS.Default;
    return { kind: "play", label: fallback.label };
  }

  if (cfg.messageMode === "llm" && cfg.geminiApiKey) {
    try {
      const input: GenerationInput = { text: clampHead(raw) };
      const llm = (
        await new GeminiProvider(cfg.geminiApiKey).generate(input)
      ).trim();
      const clean = sanitizeForSpeech(llm);
      if (clean)
        return {
          kind: "say",
          text: clampSentences(clean, SPEECH_MAX_CHARS, SPEECH_MAX_SENTENCES),
        };
    } catch {
      // Sin key, error HTTP o timeout: se degrada al resumen local de abajo.
    }
  }

  // Degradación local determinista: las primeras oraciones del turno, que es
  // donde la hipótesis de producto sitúa el resumen, acotadas por el tope de
  // oraciones y frenadas por el techo de caracteres. Ninguno de los dos topes
  // parte una oración.
  return {
    kind: "say",
    text: clampSentences(primary, SPEECH_MAX_CHARS, SPEECH_MAX_SENTENCES),
  };
}
