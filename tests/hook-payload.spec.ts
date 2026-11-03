// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// La puerta de entrada del plugin: parseo del JSON que Claude Code entrega por
// stdin. Procesa input que el plugin no controla y jamás debe lanzar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayload } from "../src/lib/hook-payload.js";

test("parsePayload devuelve el objeto tipado ante un payload bien formado", () => {
  const payload = parsePayload(
    JSON.stringify({
      session_id: "abc",
      hook_event_name: "Stop",
      last_assistant_message: "Listo.",
    }),
  );
  assert.equal(payload.session_id, "abc");
  assert.equal(payload.hook_event_name, "Stop");
  assert.equal(payload.last_assistant_message, "Listo.");
});

test("parsePayload tolera campos faltantes", () => {
  const payload = parsePayload("{}");
  assert.deepEqual(payload, {});
  assert.equal(payload.last_assistant_message, undefined);
});

test("parsePayload devuelve objeto vacío ante JSON inválido, sin lanzar", () => {
  assert.deepEqual(parsePayload("{no es json"), {});
  assert.deepEqual(parsePayload(""), {});
});

test("parsePayload devuelve objeto vacío ante JSON válido que no es objeto", () => {
  assert.deepEqual(parsePayload("null"), {});
  assert.deepEqual(parsePayload("42"), {});
  assert.deepEqual(parsePayload('"texto"'), {});
  assert.deepEqual(parsePayload("true"), {});
});

test("parsePayload acepta arrays (son objetos) sin romper el acceso a campos", () => {
  // Un array es typeof object: el contrato solo exige no lanzar y permitir
  // acceder a los campos opcionales con undefined.
  const payload = parsePayload("[1,2]");
  assert.equal(payload.hook_event_name, undefined);
});
