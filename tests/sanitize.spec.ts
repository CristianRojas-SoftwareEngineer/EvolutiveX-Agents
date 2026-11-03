// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// La barrera de saneamiento antes de narrar o de enviar texto a un LLM externo:
// verifica que efectivamente quita lo que dice quitar. Comportamiento portado de
// normalize-speech-text del Orchestrator (§4 fila 11), con dos desviaciones
// deliberadas del producto: el CUERPO de los bloques de código cercados se
// descarta (el código en línea sí se conserva), y la whitelist incluye
// paréntesis, comillas y guiones. SIN truncamiento de oraciones.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPlainText,
  sanitizeForSpeech,
} from "../src/voice/message/sanitize.js";

test("toPlainText descarta el cuerpo del bloque cercado y conserva la prosa circundante", () => {
  const input = 'Antes.\n```js\nconst clave = "secreto";\n```\nDespués.';
  const out = toPlainText(input);
  assert.equal(out, "Antes. Después.");
  assert.ok(!out.includes("```"), "sin delimitadores");
  assert.ok(!out.includes("secreto"), "cuerpo del bloque descartado");
});

test("toPlainText descarta el cuerpo de los bloques cercados con virgulillas", () => {
  const out = toPlainText("Uno ~~~\ncódigo\n~~~ dos");
  assert.equal(out, "Uno dos");
  assert.ok(!out.includes("~~~"));
  assert.ok(!out.includes("código"));
});

test("toPlainText descarta el cuerpo de un bloque cercado sin cerrar", () => {
  // Mensaje truncado a mitad: la valla abierta y su cuerpo no deben narrarse.
  const out = toPlainText("Antes.\n```js\nconst a = 1;\nconst b = 2;");
  assert.equal(out, "Antes.");
  assert.ok(!out.includes("const"));
});

test("toPlainText descarta varios bloques cercados y conserva la prosa", () => {
  const out = toPlainText("Uno.\n```\nA\n```\nDos.\n```\nB\n```\nTres.");
  assert.equal(out, "Uno. Dos. Tres.");
});

test("toPlainText devuelve cadena vacía si la entrada es solo un bloque cercado", () => {
  assert.equal(toPlainText('```js\nconst clave = "secreto";\n```'), "");
  assert.equal(sanitizeForSpeech("```js\nconst clave = 1;\n```"), "");
});

test("toPlainText conserva el contenido de código en línea (rutas pronunciables)", () => {
  // Las comillas invertidas se quitan; el texto interior (ruta/comando) se conserva.
  // Los guiones se mantienen (decisión del producto) y la barra / sí se elimina.
  const out = toPlainText("Ejecuta `rm -rf /tmp/x` ahora.");
  assert.ok(!out.includes("`"));
  assert.equal(out, "Ejecuta rm -rf tmp x ahora.");
});

test("toPlainText conserva el texto de enlaces y descarta la URL", () => {
  assert.equal(
    toPlainText("Mira [la guía](https://example.com/guia) completa."),
    "Mira la guía completa.",
  );
});

test("toPlainText convierte imágenes a su texto alternativo", () => {
  assert.equal(toPlainText("![diagrama](img.png) listo"), "diagrama listo");
});

test("toPlainText elimina URLs sueltas", () => {
  const out = toPlainText("Visita https://example.com/ruta?x=1 para más.");
  assert.ok(!out.includes("example"));
  assert.equal(out, "Visita para más.");
});

test("toPlainText quita encabezados, citas y viñetas al inicio de línea", () => {
  const input =
    "## Título\n> cita\n- punto uno\n* punto dos\n1. numerado\n2) también";
  assert.equal(
    toPlainText(input),
    "Título cita punto uno punto dos numerado también",
  );
});

test("toPlainText quita énfasis y tachado", () => {
  assert.equal(
    toPlainText("**negrita** _cursiva_ ~~tachado~~"),
    "negrita cursiva tachado",
  );
});

test("toPlainText conserva acentos, eñes y puntuación del español", () => {
  const input = "¿Quién? ¡Añadió más configuración, según él!";
  assert.equal(toPlainText(input), input);
});

test("toPlainText reemplaza símbolos no narrables y colapsa espacios", () => {
  const out = toPlainText("a @ b   #   c\n\n\nd");
  assert.equal(out, "a b c d");
});

test("toPlainText conserva paréntesis, comillas y guiones", () => {
  // Paréntesis, comillas y guiones se conservan (decisión del producto).
  const input = "a(b)c'd-e\"f";
  const out = toPlainText(input);
  assert.equal(out, input);
  assert.ok(out.includes("(") && out.includes(")"));
  assert.ok(out.includes("'") && out.includes('"') && out.includes("-"));
});

test("toPlainText tolera entrada vacía y valores nulos", () => {
  assert.equal(toPlainText(""), "");
  // La firma exige string, pero el código defiende contra null en runtime.
  assert.equal(toPlainText(null as unknown as string), "");
});

// --- sanitizeForSpeech: pipeline completo, SIN truncamiento ---

test("sanitizeForSpeech devuelve cadena vacía si no queda nada utilizable", () => {
  assert.equal(sanitizeForSpeech(""), "");
  assert.equal(sanitizeForSpeech("@#$%^&*"), "");
});

test("sanitizeForSpeech conserva TODAS las oraciones (sin truncar a 2)", () => {
  const out = sanitizeForSpeech("Uno. Dos. Tres. Cuatro. Cinco.");
  assert.equal(out, "Uno. Dos. Tres. Cuatro. Cinco.");
});

test("sanitizeForSpeech NO recorta a 320 caracteres (fidelidad al Orchestrator)", () => {
  const larga = ("palabra ".repeat(200) + "fin.").trim();
  const out = sanitizeForSpeech(larga);
  assert.ok(out.length > 320, `esperado >320, fue ${out.length}`);
  assert.ok(out.endsWith("fin."));
});

test("sanitizeForSpeech integra el pipeline completo sin truncar", () => {
  const input =
    "# Resultado\nSe corrigió el **bug** en `config.ts`. Ver [detalles](https://x.dev). Tercera oración.";
  const out = sanitizeForSpeech(input);
  assert.ok(!out.includes("**"), "sin énfasis");
  assert.ok(!out.includes("`"), "sin backticks");
  assert.ok(out.includes("config.ts"), "ruta conservada");
  assert.ok(out.includes("bug"), "texto de énfasis conservado");
  assert.ok(out.includes("Tercera oración"), "sin truncamiento de oraciones");
});
