// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Topes deterministas: clampHead conserva la cabeza cortando en párrafo;
// clampSentences acumula oraciones completas y frena por dos topes a la vez —
// el de oraciones (criterio de selección) y el de caracteres (freno de
// emergencia) — sin partir ninguna, salvo la oración-gigante, que se corta en
// límite de palabra. Ambas puras: mismo input → mismo output; vacío → "".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampHead,
  clampSentences,
  LLM_INPUT_MAX_CHARS,
  SPEECH_MAX_SENTENCES,
} from "../src/voice/message/clamp.js";

// --- clampHead ---

test("clampHead devuelve el texto tal cual si ya cabe", () => {
  const t = "Un mensaje corto que cabe sin problema.";
  assert.equal(clampHead(t), t);
});

test("clampHead corta en el último límite de párrafo por debajo del tope", () => {
  const p1 = "A".repeat(10000);
  const p2 = "B".repeat(10000);
  const out = clampHead(`${p1}\n\n${p2}`);
  assert.equal(out, p1);
  assert.ok(out.length <= LLM_INPUT_MAX_CHARS);
});

test("clampHead sin párrafo retrocede a límite de palabra", () => {
  const word = "palabra ";
  const text = word.repeat(3000); // ~24000 chars, sin '\n\n'
  const out = clampHead(text);
  assert.ok(out.length <= LLM_INPUT_MAX_CHARS);
  assert.ok(!out.endsWith("palab")); // nunca a mitad de palabra
  assert.ok(out.endsWith("palabra"));
});

test("clampHead con palabra única más larga que el tope hace corte duro", () => {
  const giant = "x".repeat(LLM_INPUT_MAX_CHARS + 500);
  const out = clampHead(giant);
  assert.equal(out.length, LLM_INPUT_MAX_CHARS);
});

test("clampHead con texto vacío devuelve ''", () => {
  assert.equal(clampHead(""), "");
});

// --- clampSentences ---

test("clampSentences acumula oraciones completas hasta el tope", () => {
  const text = "Una. Dos. Tres. Cuatro.";
  // Tope que admite "Una. Dos." pero no "Tres.".
  const out = clampSentences(text, 10, 2);
  assert.equal(out, "Una. Dos.");
});

test("clampSentences devuelve el texto entero si ya cabe en ambos topes", () => {
  const text = "Corto y completo.";
  assert.equal(clampSentences(text, 400, SPEECH_MAX_SENTENCES), text);
});

test("clampSentences reconoce los terminadores . ! ? …", () => {
  const text = "Hecho! ¿Sigo? Claro… Fin.";
  const out = clampSentences(text, 14, 2);
  assert.equal(out, "Hecho! ¿Sigo?");
});

test("clampSentences corta la oración-gigante en límite de palabra, sin puntos suspensivos", () => {
  const text =
    "Esta primera oración es mucho más larga que el tope permitido aquí.";
  const out = clampSentences(text, 20, SPEECH_MAX_SENTENCES);
  assert.ok(out.length <= 20);
  assert.ok(!out.endsWith("…"));
  assert.ok(!out.endsWith(" "));
  // No corta a mitad de palabra: la última palabra está completa.
  assert.ok(text.startsWith(out));
  assert.ok(out.split(" ").every((w) => text.includes(w)));
});

test("clampSentences con tope exacto incluye la oración que encaja justo", () => {
  const text = "Uno dos tres. Cuatro.";
  assert.equal(
    clampSentences(text, "Uno dos tres.".length, SPEECH_MAX_SENTENCES),
    "Uno dos tres.",
  );
});

test("clampSentences con texto vacío o solo espacios devuelve ''", () => {
  assert.equal(clampSentences("", 400, SPEECH_MAX_SENTENCES), "");
  assert.equal(clampSentences("   ", 400, SPEECH_MAX_SENTENCES), "");
});

test("clampSentences el tope de oraciones frena aunque el texto quepa en el techo de caracteres", () => {
  const text = "Uno. Dos. Tres. Cuatro.";
  const out = clampSentences(text, 500, 2);
  assert.equal(out, "Uno. Dos.");
  assert.ok(out.length <= 500, "el techo de caracteres no es el criterio aquí");
});

test("clampSentences el techo de caracteres retira la segunda oración, no parte la primera", () => {
  const first = `${"a".repeat(295)}.`;
  const second = `${"b".repeat(295)}.`;
  const text = `${first} ${second}`;
  assert.ok(text.length > 500, "el texto completo excede el techo");
  const out = clampSentences(text, 500, SPEECH_MAX_SENTENCES);
  assert.equal(out, first, "oración entera, no un fragmento");
  assert.ok(out.length <= 500);
  assert.ok(!out.includes("b"));
});

test("clampSentences no fragmenta números de versión ni decimales", () => {
  assert.equal(
    clampSentences("Actualicé a v1.0.2 hoy. Segunda. Tercera.", 500, 2),
    "Actualicé a v1.0.2 hoy. Segunda.",
  );
  assert.equal(
    clampSentences("El valor es 3.14 exactos. Segunda.", 500, 2),
    "El valor es 3.14 exactos. Segunda.",
  );
  // El punto que CIERRA un número sí es terminador.
  assert.equal(
    clampSentences("Subí a v1.0.2. Segunda. Tercera.", 500, 2),
    "Subí a v1.0.2. Segunda.",
  );
});

test("clampSentences con un decimalisolado no genera oraciones espurias", () => {
  // Sin el guardia de dígitos, "2." abriría y cerraría oraciones en cascada.
  const out = clampSentences("Vale 2. Sigo. Otra.", 500, 2);
  assert.equal(out, "Vale 2. Sigo.");
});
