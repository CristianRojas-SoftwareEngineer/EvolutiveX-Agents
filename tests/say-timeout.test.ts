// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Timeout de `speech say`: crece con el texto porque cubre síntesis completa +
// reproducción. Fija el margen fijo, la pendiente por carácter y que el plazo
// cubra con holgura lo medido en el motor (≈ 3 s + 0,24 s por carácter) hasta el
// techo de caracteres de toda locución dinámica.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAY_BASE_MS,
  SAY_PER_CHAR_MS,
  sayTimeoutMs,
} from "../src/voice/say-timeout.js";
import { SPEECH_MAX_CHARS } from "../src/voice/message/clamp.js";

test("sayTimeoutMs parte del margen fijo y crece linealmente con el texto", () => {
  assert.equal(sayTimeoutMs(""), SAY_BASE_MS);
  assert.equal(
    sayTimeoutMs("a".repeat(10)),
    SAY_BASE_MS + 10 * SAY_PER_CHAR_MS,
  );
  assert.equal(sayTimeoutMs("a".repeat(254)), 131_600);
});

test("sayTimeoutMs cubre lo medido con margen en todo el rango de la locución", () => {
  for (const chars of [1, 50, 175, 254, SPEECH_MAX_CHARS]) {
    const measuredMs = 3_000 + chars * 240;
    assert.ok(
      sayTimeoutMs("a".repeat(chars)) >= 1.5 * measuredMs,
      `${chars} caracteres`,
    );
  }
  assert.equal(sayTimeoutMs("a".repeat(SPEECH_MAX_CHARS)), 230_000);
});
