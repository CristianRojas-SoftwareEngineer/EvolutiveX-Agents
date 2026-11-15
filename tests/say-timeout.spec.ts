// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Timeout de `speech say`: crece con el texto porque el comando dura lo que el
// audio (reproduce mientras se sintetiza). Fija el margen fijo, la pendiente por
// carácter y que el plazo cubra con holgura lo medido en el motor (27,2 s para
// 450 caracteres, con carga de memoria) hasta el techo de caracteres de toda
// locución dinámica.
const MEASURED_MS = 27_204;
const MEASURED_CHARS = 450;
const MEASURED_MS_PER_CHAR = MEASURED_MS / MEASURED_CHARS;

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
  assert.equal(
    sayTimeoutMs("a".repeat(254)),
    SAY_BASE_MS + 254 * SAY_PER_CHAR_MS,
  );
});

test("sayTimeoutMs cubre lo medido con margen en todo el rango de la locución", () => {
  for (const chars of [1, 50, 175, 254, SPEECH_MAX_CHARS]) {
    const measuredMs = chars * MEASURED_MS_PER_CHAR;
    assert.ok(
      sayTimeoutMs("a".repeat(chars)) >= 1.5 * measuredMs,
      `${chars} caracteres`,
    );
  }
  assert.equal(
    sayTimeoutMs("a".repeat(SPEECH_MAX_CHARS)),
    SAY_BASE_MS + SPEECH_MAX_CHARS * SAY_PER_CHAR_MS,
  );
});
