// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Timeout de `speech say --daemon`. El motor entrega el audio por partes y el
// cliente lo reproduce mientras se sintetiza, así que el comando dura
// aproximadamente lo que dura el audio y el plazo crece con el texto. Un plazo
// fijo cortaría las locuciones largas en plena reproducción. Medido con una
// frase de 450 caracteres (27,2 s de comando, mediana de 5 ejecuciones) con un
// proceso de carga de memoria en marcha, la condición más lenta aceptada:
// ≈ 60 ms por carácter. La constante por carácter da una holgura de 1,65× sobre
// eso (redondeada hacia arriba a un múltiplo de 10 ms) para equipos más lentos, y
// el margen fijo cubre el arranque en frío. Como toda locución dinámica pasa por
// `clampSentences` (SPEECH_MAX_CHARS = 500), el plazo máximo es
// 30 s + 500 × 0,1 s = 80 s. Al vencer, el cliente muere y el daemon cancela la
// síntesis en curso, sin dejar trabajo pendiente.

/** Margen fijo: ida y vuelta al daemon y arranque en frío del motor. */
export const SAY_BASE_MS = 30_000;

/** Margen por carácter: reproducción en streaming, con holgura sobre lo medido. */
export const SAY_PER_CHAR_MS = 100;

/** Plazo de `speech say` para `text`: SAY_BASE_MS + SAY_PER_CHAR_MS por carácter. */
export function sayTimeoutMs(text: string): number {
  return SAY_BASE_MS + text.length * SAY_PER_CHAR_MS;
}
