// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Caracterización del contrato anti-invención: el system prompt
// prohíbe inventar y nombra el turno trivial; existe el cierre no presuntivo.
// El modo único eliminó GenerationMode y systemPromptFor.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_CLOSING,
} from "../src/voice/message/prompts.js";

test("SUMMARY_SYSTEM_PROMPT prohíbe inventar y narra en primera persona", () => {
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("No inventes"));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("primera persona"));
});

test("SUMMARY_SYSTEM_PROMPT contempla el turno trivial (saludo/conversación breve)", () => {
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("saludo"));
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes("naturalidad"));
});

test("SUMMARY_CLOSING es el cierre no presuntivo, fiel al turno", () => {
  assert.ok(SUMMARY_CLOSING.includes("fiel a lo que ocurrió en este turno"));
  assert.ok(!SUMMARY_CLOSING.includes("lograste"));
});
