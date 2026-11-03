// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Caché de la voz activa: escritura idempotente (solo si cambia), lectura con
// y sin archivo y archivo ilegible tratado como ausente. State dir aislado.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { activeVoicePath, ensureStateDir } from "../src/lib/state-dir.js";
import {
  readActiveVoice,
  writeActiveVoice,
} from "../src/voice/active-voice.js";
import { isolateStateDir } from "./helpers.js";

let restore: () => void;

beforeEach(() => {
  restore = isolateStateDir().restore;
});

afterEach(() => {
  restore();
});

test("sin caché, readActiveVoice devuelve default con origen default", () => {
  assert.deepEqual(readActiveVoice(), { voice: "default", source: "default" });
});

test("writeActiveVoice crea el state dir y la caché se lee con origen cache", () => {
  writeActiveVoice("mi_voz");
  assert.equal(readFileSync(activeVoicePath(), "utf8"), "mi_voz\n");
  assert.deepEqual(readActiveVoice(), { voice: "mi_voz", source: "cache" });
  // La escritura atómica no deja temporales en el state dir.
  assert.deepEqual(readdirSync(dirname(activeVoicePath())), ["active-voice"]);
});

test("writeActiveVoice no reescribe el archivo si el contenido no cambia", () => {
  writeActiveVoice("mi_voz");
  const past = new Date(Date.now() - 60_000);
  utimesSync(activeVoicePath(), past, past);
  const before = statSync(activeVoicePath()).mtimeMs;
  writeActiveVoice("mi_voz");
  assert.equal(statSync(activeVoicePath()).mtimeMs, before);
  writeActiveVoice("default");
  assert.equal(readActiveVoice().voice, "default");
  assert.notEqual(statSync(activeVoicePath()).mtimeMs, before);
});

test("una caché vacía cuenta como ausente", () => {
  ensureStateDir();
  writeFileSync(activeVoicePath(), "  \n");
  assert.deepEqual(readActiveVoice(), { voice: "default", source: "default" });
});

test("una caché ilegible (un directorio) cae a default y la escritura no lanza", () => {
  mkdirSync(activeVoicePath(), { recursive: true });
  assert.deepEqual(readActiveVoice(), { voice: "default", source: "default" });
  assert.doesNotThrow(() => writeActiveVoice("mi_voz"));
});
