// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Nombre de presentación de la voz custom: escritura atómica sin
// temporales, lectura con y sin archivo, contenido inválido tratado como
// ausente y borrado idempotente. State dir aislado.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { customDisplayNamePath, ensureStateDir } from "../src/lib/state-dir.js";
import {
  readCustomDisplayName,
  removeCustomDisplayName,
  writeCustomDisplayName,
} from "../src/voice/custom-display-name.js";
import { isolateStateDir } from "./helpers.js";

let restore: () => void;

beforeEach(() => {
  restore = isolateStateDir().restore;
});

afterEach(() => {
  restore();
});

test("sin archivo no hay nombre de presentación", () => {
  assert.equal(readCustomDisplayName(), undefined);
});

test("writeCustomDisplayName guarda el nombre sin dejar temporales", () => {
  writeCustomDisplayName("Cristián");
  assert.equal(readFileSync(customDisplayNamePath(), "utf8"), "Cristián\n");
  assert.equal(readCustomDisplayName(), "Cristián");
  assert.deepEqual(readdirSync(dirname(customDisplayNamePath())), [
    "custom-display-name",
  ]);
});

test("un contenido inválido (vacío o demasiado largo) cuenta como ausente", () => {
  ensureStateDir();
  for (const raw of ["  \n", "x".repeat(65)]) {
    writeFileSync(customDisplayNamePath(), raw);
    assert.equal(readCustomDisplayName(), undefined);
  }
});

test("removeCustomDisplayName borra el nombre y no falla si no existe", () => {
  writeCustomDisplayName("Cristián");
  removeCustomDisplayName();
  assert.equal(readCustomDisplayName(), undefined);
  assert.doesNotThrow(() => removeCustomDisplayName());
});
