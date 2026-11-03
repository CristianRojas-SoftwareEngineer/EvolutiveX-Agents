// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Topes de tamaño deterministas y puros para las dos rutas del subsistema:
// `clampHead` acota el input al LLM (conserva la cabeza) y `clampSentences`
// acota la degradación local (oraciones completas, con dos topes: uno de
// selección y otro de emergencia). Ninguna función tiene efectos secundarios ni
// depende del reloj: mismo input → mismo output. `sanitizeForSpeech` NO se toca
// (su contrato heredado «sin truncamiento» se conserva; el corte es
// responsabilidad de quien lo necesita).

/** Tope generoso del input al LLM (~4k tokens): protege timeout y cuota. */
export const LLM_INPUT_MAX_CHARS = 16000;

/**
 * Criterio de selección de la degradación local: cuántas oraciones se narran.
 * La hipótesis de producto es que las primeras frases del turno concentran la
 * respuesta general y resumida. Dos oraciones bastan para dar orientación y la
 * señal de si hay que volver a la pantalla; una sola puede ser solo preámbulo
 * («voy a revisar el archivo») y no transportar ningún resultado, y más de
 * dos introduce referencias colgantes y fragmentos de código.
 */
export const LOCAL_SPEECH_MAX_SENTENCES = 2;

/**
 * Techo de caracteres de la degradación local. NO es el criterio de selección
 * (eso es `LOCAL_SPEECH_MAX_SENTENCES`): es el freno de emergencia que acota los
 * turnos patológicos. En el caso normal no llega a activarse, porque dos
 * oraciones de prosa suelen caber de sobra; 500 caracteres ≈ 40 s de locución a
 * ritmo TTS español, por encima de lo cual el audio pierde inteligibilidad.
 */
export const LOCAL_SPEECH_MAX_CHARS = 500;

/** Terminadores de oración reconocidos por `clampSentences`. */
const SENTENCE_TERMINATORS = new Set([".", "!", "?", "…"]);

/**
 * Conserva la CABEZA del texto hasta `LLM_INPUT_MAX_CHARS`, cortando en el
 * último límite de párrafo (`\n\n`) por debajo del tope; si no hay párrafo,
 * retrocede al último límite de palabra. Nunca corta a mitad de palabra.
 * Devuelve el texto tal cual si ya cabe; texto vacío → "".
 */
export function clampHead(text: string): string {
  const t = text ?? "";
  if (t.length <= LLM_INPUT_MAX_CHARS) return t;

  const window = t.slice(0, LLM_INPUT_MAX_CHARS);

  // Preferir el último límite de párrafo dentro de la ventana.
  const lastPara = window.lastIndexOf("\n\n");
  if (lastPara > 0) return window.slice(0, lastPara).trimEnd();

  // Sin párrafo: retroceder al último límite de palabra (espacio).
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();

  // Palabra única más larga que el tope: corte duro.
  return window;
}

/**
 * Acumula ORACIONES COMPLETAS (terminadores `.`, `!`, `?`, `…`) mientras no se
 * supere ninguno de los dos topes: `maxSentences` (criterio de selección) ni
 * `maxChars` (freno de emergencia). Ninguno de los dos topes parte una oración;
 * el que frena siempre retira la última oración completa. Caso excepcional: si
 * la primera oración ya excede `maxChars` por sí sola, se corta en el último
 * límite de palabra (sin puntos suspensivos, no se pronuncian). Puro y
 * determinista; texto vacío → "".
 */
export function clampSentences(
  text: string,
  maxChars: number,
  maxSentences: number,
): string {
  const t = (text ?? "").trim();
  if (!t) return "";

  const sentences = splitSentences(t);
  if (t.length <= maxChars && sentences.length <= maxSentences) return t;

  let acc = "";
  let count = 0;
  for (const sentence of sentences) {
    if (count >= maxSentences) break;
    const next = acc ? `${acc} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    acc = next;
    count++;
  }

  if (acc) return acc;

  // La primera oración ya excede el tope: cortar en límite de palabra.
  const window = t.slice(0, maxChars);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  return window;
}

/** Divide en oraciones completas conservando su terminador y espaciado normal. */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (SENTENCE_TERMINATORS.has(text[i])) {
      // Un punto rodeado de dígitos no es un terminador: los decimales (3.14) y
      // los números de versión (v1.0.2) se fragmentarían en trozos que se leen
      // como basura. El resto de puntos sí corta, incluido el que cierra un
      // número ("subí a v1.0.2.").
      if (text[i] === "." && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
        continue;
      }
      // Consumir terminadores consecutivos (p. ej. "?!" o "...").
      let end = i + 1;
      while (end < text.length && SENTENCE_TERMINATORS.has(text[end])) end++;
      const sentence = text.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      i = end - 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/** Carácter ASCII de dígito; un borde del texto cuenta como no-dígito. */
function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}
