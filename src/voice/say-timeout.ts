// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Timeout de `speech say --daemon`. El CLI no transmite el audio: el daemon
// sintetiza la locución completa y después el cliente la reproduce, así que el
// plazo cubre síntesis + reproducción y crece con el texto. Un plazo fijo corta
// las locuciones largas en plena reproducción. Medido en el motor v0.42.0
// (Qwen3-TTS 0.6B, CPU de 4 hilos): síntesis + reproducción ≈ 3 s + 0,24 s por
// carácter (RTF 1,8-2,8). Las constantes dan un margen de ~1,65× por carácter
// para equipos más lentos y un fijo holgado para el arranque en frío. Como toda
// locución dinámica pasa por `clampSentences` (SPEECH_MAX_CHARS = 500), el
// plazo máximo es 30 s + 500 × 0,4 s = 230 s. Al vencer, el cliente muere y el
// daemon cancela la síntesis en curso, sin dejar trabajo pendiente.

/** Margen fijo: ida y vuelta al daemon y arranque en frío del motor. */
export const SAY_BASE_MS = 30_000;

/** Margen por carácter: síntesis y reproducción, con holgura sobre lo medido. */
export const SAY_PER_CHAR_MS = 400;

/** Plazo de `speech say` para `text`: SAY_BASE_MS + SAY_PER_CHAR_MS por carácter. */
export function sayTimeoutMs(text: string): number {
  return SAY_BASE_MS + text.length * SAY_PER_CHAR_MS;
}
