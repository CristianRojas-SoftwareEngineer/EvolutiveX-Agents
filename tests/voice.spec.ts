// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Reglas puras de voces: normalización, plausibilidad del nombre, voces de
// fábrica, parseo de `voice list --json` y comparación con la versión mínima
// del motor. Sin motor ni disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VOICE,
  FACTORY_VOICES,
  MIN_ENGINE_VERSION,
  isFactoryVoice,
  isPlausibleVoiceName,
  meetsMinVersion,
  normalizeVoiceName,
  parseVoiceList,
} from "../src/voice/voice.js";

test("las constantes fijan la voz por defecto, las de fábrica y la versión mínima", () => {
  assert.equal(DEFAULT_VOICE, "default");
  assert.deepEqual([...FACTORY_VOICES], ["default", "ryan", "vivian"]);
  assert.equal(MIN_ENGINE_VERSION, "0.42.0");
});

test("normalizeVoiceName recorta y pasa a minúsculas", () => {
  assert.equal(normalizeVoiceName("  Mi_Voz  "), "mi_voz");
  assert.equal(normalizeVoiceName("DEFAULT"), "default");
  assert.equal(normalizeVoiceName("   "), "");
});

test("isPlausibleVoiceName acepta letras y números ASCII, punto, guion y guion bajo", () => {
  for (const name of ["default", "mi_voz", "voz-2", "v.1", "A", "x".repeat(64)])
    assert.equal(isPlausibleVoiceName(name), true, name);
});

test("isPlausibleVoiceName rechaza vacío, largo, `..`, separadores y no ASCII", () => {
  for (const name of [
    "",
    "x".repeat(65),
    "..",
    "a..b",
    "a/b",
    "a\\b",
    "mi voz",
    "voz-ñ",
    "café",
  ])
    assert.equal(isPlausibleVoiceName(name), false, name);
});

test("isFactoryVoice reconoce solo las voces de fábrica", () => {
  for (const name of ["default", "ryan", "vivian"])
    assert.equal(isFactoryVoice(name), true);
  for (const name of ["mi_voz", "Default", ""])
    assert.equal(isFactoryVoice(name), false);
});

test("parseVoiceList devuelve las voces y tolera claves adicionales", () => {
  assert.deepEqual(parseVoiceList('{"voices":["default","mi_voz"]}'), [
    "default",
    "mi_voz",
  ]);
  assert.deepEqual(
    parseVoiceList('{"schema_version":"6","voices":[],"extra":1}'),
    [],
  );
});

test("parseVoiceList devuelve undefined ante cualquier otra forma", () => {
  for (const stdout of [
    "",
    "no es json",
    "[]",
    "null",
    '"voices"',
    "{}",
    '{"voices":"default"}',
    '{"voices":["default",1]}',
  ])
    assert.equal(parseVoiceList(stdout), undefined, stdout);
});

test("meetsMinVersion compara major.minor.patch numéricamente", () => {
  assert.equal(meetsMinVersion("0.42.0"), true);
  assert.equal(meetsMinVersion("0.42.1"), true);
  assert.equal(meetsMinVersion("0.100.0"), true);
  assert.equal(meetsMinVersion("1.0.0"), true);
  assert.equal(meetsMinVersion("0.41.9"), false);
  assert.equal(meetsMinVersion("0.9.99"), false);
});

test("meetsMinVersion devuelve false ante una versión ilegible", () => {
  for (const version of ["", "0.42", "v0.42.0", "abc", "0.42.x"])
    assert.equal(meetsMinVersion(version), false, version);
});
