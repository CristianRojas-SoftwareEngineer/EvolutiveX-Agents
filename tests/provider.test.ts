// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// buildUserContent construye el ÚNICO mensaje `user` del proveedor con el
// material del turno y el cierre anti-invención; nunca inyecta historial.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserContent } from "../src/voice/message/provider.js";
import { SUMMARY_CLOSING } from "../src/voice/message/prompts.js";

test("buildUserContent devuelve el contenido del mensaje user con material y cierre", () => {
  const out = buildUserContent({ text: "Creé el componente principal." });
  assert.equal(
    out,
    `Material del turno:\n\nCreé el componente principal.\n\n${SUMMARY_CLOSING}`,
  );
});

test("buildUserContent recorta el material y nunca inyecta historial", () => {
  const out = buildUserContent({ text: "  Hola.  " });
  assert.equal(out, `Material del turno:\n\nHola.\n\n${SUMMARY_CLOSING}`);
});

test("buildUserContent con texto vacío conserva el contenido del mensaje user", () => {
  const out = buildUserContent({ text: "" });
  assert.equal(out, `Material del turno:\n\n\n\n${SUMMARY_CLOSING}`);
});
