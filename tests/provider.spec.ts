// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// buildUserContent construye el ÚNICO mensaje `user` del proveedor con el
// mensaje del asistente y el cierre que pide parafrasearlo; nunca inyecta historial.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserContent } from "../src/voice/message/provider.js";
import { SUMMARY_CLOSING } from "../src/voice/message/prompts.js";

test("buildUserContent devuelve el contenido del mensaje user con el mensaje y el cierre", () => {
  const out = buildUserContent({ text: "Creé el componente principal." });
  assert.equal(
    out,
    `Mensaje del asistente:\n\nCreé el componente principal.\n\n${SUMMARY_CLOSING}`,
  );
});

test("buildUserContent recorta el mensaje y nunca inyecta historial", () => {
  const out = buildUserContent({ text: "  Hola.  " });
  assert.equal(out, `Mensaje del asistente:\n\nHola.\n\n${SUMMARY_CLOSING}`);
});

test("buildUserContent con texto vacío conserva el contenido del mensaje user", () => {
  const out = buildUserContent({ text: "" });
  assert.equal(out, `Mensaje del asistente:\n\n\n\n${SUMMARY_CLOSING}`);
});
