// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Tests de contrato del proveedor Gemini con fetch mockeado: serialización del
// mensaje único, parseo de la respuesta, HTTP no-ok y respuesta vacía. Nunca
// tocan la red.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../src/message/gemini-provider.js";
import type { GenerationInput } from "../src/message/provider.js";
import { SUMMARY_CLOSING } from "../src/message/prompts.js";

const INPUT: GenerationInput = { text: "Terminé la tarea." };
const EXPECTED_CONTENT = `Material del turno:\n\nTerminé la tarea.\n\n${SUMMARY_CLOSING}`;

const realFetch = globalThis.fetch;
let lastRequest: { url: string; init: RequestInit } | undefined;

function mockFetch(status: number, payload: unknown): void {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    lastRequest = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  lastRequest = undefined;
});

// --- Gemini ---

test("Gemini: usa el modelo gemini-3.1-flash-lite y el endpoint generateContent", async () => {
  mockFetch(200, {
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
  });
  await new GeminiProvider("clave").generate(INPUT);
  assert.ok(lastRequest?.url.includes("gemini-3.1-flash-lite"));
  assert.ok(lastRequest?.url.includes(":generateContent"));
});

test("Gemini: manda la clave por header, nunca en la URL", async () => {
  mockFetch(200, {
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
  });
  await new GeminiProvider("clave-secreta").generate(INPUT);
  const headers = lastRequest?.init.headers as Record<string, string>;
  assert.equal(headers["x-goog-api-key"], "clave-secreta");
  assert.ok(!lastRequest?.url.includes("clave-secreta"));
});

test("Gemini: serializa el único mensaje user con material y cierre", async () => {
  mockFetch(200, {
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
  });
  await new GeminiProvider("clave").generate(INPUT);
  const body = JSON.parse(lastRequest!.init.body as string);
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: EXPECTED_CONTENT }] },
  ]);
  assert.ok(body.systemInstruction.parts[0].text.includes("No inventes"));
});

test("Gemini: extrae y une el texto de las parts de la respuesta", async () => {
  mockFetch(200, {
    candidates: [
      { content: { parts: [{ text: "Hola " }, { text: "mundo" }] } },
    ],
  });
  const text = await new GeminiProvider("clave").generate(INPUT);
  assert.equal(text, "Hola mundo");
});

test("Gemini: lanza ante HTTP no-ok con el status en el mensaje", async () => {
  mockFetch(429, {});
  await assert.rejects(
    () => new GeminiProvider("clave").generate(INPUT),
    /Gemini HTTP 429/,
  );
});

test("Gemini: lanza ante una respuesta sin texto", async () => {
  mockFetch(200, { candidates: [] });
  await assert.rejects(
    () => new GeminiProvider("clave").generate(INPUT),
    /vacía/,
  );
});

test("Gemini: lanza sin llamar a fetch si no hay API key", async () => {
  mockFetch(200, {});
  await assert.rejects(
    () => new GeminiProvider("").generate(INPUT),
    /sin API key/,
  );
  assert.equal(lastRequest, undefined);
});
