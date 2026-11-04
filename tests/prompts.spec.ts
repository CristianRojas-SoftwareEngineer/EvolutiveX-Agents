// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Caracterización del contrato de paráfrasis: el system prompt pide decir el
// mensaje condensado en lugar de relatarlo, conserva su intención y prohíbe
// inventar; el cierre pide parafrasear. El modo único eliminó GenerationMode y
// systemPromptFor.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_CLOSING,
} from "../src/voice/message/prompts.js";

test("SUMMARY_SYSTEM_PROMPT pide parafrasear el mensaje y prohíbe inventar", () => {
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("Parafrasea el mensaje"));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("No inventes"));
});

test("SUMMARY_SYSTEM_PROMPT prohíbe relatar el mensaje desde fuera", () => {
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("no lo describas ni lo relates"));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("Te he saludado"));
});

test("SUMMARY_SYSTEM_PROMPT conserva la intención del original", () => {
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("si pregunta, pregunta"));
});

test("SUMMARY_CLOSING pide parafrasear como mensaje propio, no relatar el turno", () => {
  assert.ok(SUMMARY_CLOSING.includes("parafraseado"));
  assert.ok(SUMMARY_CLOSING.includes("como si fuera tu propio mensaje"));
  assert.ok(!SUMMARY_CLOSING.includes("lo que ocurrió"));
});
