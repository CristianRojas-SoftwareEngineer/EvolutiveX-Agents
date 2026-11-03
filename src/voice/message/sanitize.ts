// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Normalización del texto para voz: convierte texto potencialmente con markdown,
// código y símbolos en texto plano apto para leerse en voz alta. Se aplica tanto
// a la salida del LLM (los modelos free no siempre obedecen el formato) como al
// constructor local. Basado en normalize-speech-text del Orchestrator (§4 fila
// 11) y SIN truncamiento de oraciones, pero con dos desviaciones deliberadas
// del producto: (1) el cuerpo de los bloques de código cercados se descarta, y
// (2) paréntesis, comillas y guiones se CONSERVAN (no mutilar la frase; si
// molestan al leerse, se eliminan después).

/** Limpia markdown/código/símbolos y colapsa espacios. No recorta oraciones. */
export function toPlainText(input: string): string {
  let t = input ?? "";

  // Bloques de código cercados: se descarta el CUERPO entero, no solo los
  // delimitadores. El contenido de un bloque es código, no prosa que mencione
  // una ruta: narrarlo consume el presupuesto de la locución y degrada su
  // inteligibilidad. Las rutas y los identificadores siguen siendo
  // pronunciables por la regla de código en línea de más abajo, que es la forma
  // en que la prosa los cita.
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " ");
  // Bloque cercado abierto y nunca cerrado (mensaje truncado a mitad): desde la
  // apertura hasta el final. Se aplica DESPUÉS de la regla anterior, que ya
  // retiró los bloques cerrados, así que toda valla que sobreviva aquí está
  // sin cerrar.
  t = t.replace(/```[\s\S]*$/g, " ");
  t = t.replace(/~~~[\s\S]*$/g, " ");
  // Código en línea: se quitan las comillas invertidas, conservando el texto
  // (es donde viajan las rutas y los nombres de archivo, que sí se pronuncian).
  t = t.replace(/`([^`]*)`/g, "$1");
  // Enlaces markdown [texto](url) → texto; imágenes ![alt](url) → alt.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  // URLs sueltas.
  t = t.replace(/https?:\/\/\S+/g, " ");
  // Encabezados, citas y viñetas al inicio de línea.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, "");
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, "");
  // Énfasis y tachado.
  t = t.replace(/[*_~]{1,3}/g, "");
  // Símbolos que no se leen bien; se conservan letras, dígitos, espacios,
  // acentos/ñ/ü, puntuación básica del español, paréntesis, comillas y guiones
  // (decisión del producto: se conservan para no mutilar la frase; si molestan
  // al leerse, se eliminan después).
  t = t.replace(/[^\p{L}\p{N}\s.,;:¿?¡!()'"-]/gu, " ");
  // Colapsar espacios y saltos de línea.
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

/**
 * Pipeline completo para voz: texto plano, sin truncar (fidelidad a lo probado
 * en el Orchestrator) y con el cuerpo de los bloques de código cercados
 * descartado. Devuelve "" si no queda nada utilizable.
 */
export function sanitizeForSpeech(input: string): string {
  return toPlainText(input);
}
