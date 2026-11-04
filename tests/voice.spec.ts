// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Reglas puras de voces: normalización, voces de fábrica, voz personalizada y
// voces seleccionables en /config (que deben coincidir con `options` del
// manifiesto), nombre de presentación, parseo de `voice list --json` y
// comparación con la versión mínima del motor. Sin motor ni disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import manifest from "../.claude-plugin/plugin.json" with { type: "json" };
import {
  CUSTOM_VOICE,
  DEFAULT_VOICE,
  FACTORY_VOICES,
  MIN_ENGINE_VERSION,
  SELECTABLE_VOICES,
  isFactoryVoice,
  isSelectableVoice,
  meetsMinVersion,
  normalizeDisplayName,
  normalizeVoiceName,
  parseVoiceList,
} from "../src/voice/voice.js";

test("las constantes fijan la voz por defecto, las de fábrica, custom y la versión mínima", () => {
  assert.equal(DEFAULT_VOICE, "default");
  assert.deepEqual([...FACTORY_VOICES], ["default", "ryan", "vivian"]);
  assert.equal(CUSTOM_VOICE, "custom");
  assert.equal(MIN_ENGINE_VERSION, "0.44.0");
});

test("las voces seleccionables coinciden con options y default de userConfig.voice", () => {
  const field = manifest.userConfig.voice;
  assert.deepEqual([...SELECTABLE_VOICES], field.options);
  assert.equal(field.default, DEFAULT_VOICE);
});

test("isSelectableVoice acepta solo las opciones de /config", () => {
  for (const name of ["default", "ryan", "vivian", "custom"])
    assert.equal(isSelectableVoice(name), true, name);
  for (const name of ["mi_voz", "Custom", "", "voz_inexistente"])
    assert.equal(isSelectableVoice(name), false, name);
});

test("normalizeVoiceName recorta y pasa a minúsculas", () => {
  assert.equal(normalizeVoiceName("  Mi_Voz  "), "mi_voz");
  assert.equal(normalizeVoiceName("DEFAULT"), "default");
  assert.equal(normalizeVoiceName("   "), "");
});

test("normalizeDisplayName recorta, colapsa espacios y admite acentos y espacios", () => {
  assert.equal(normalizeDisplayName("  Cristián   Rojas "), "Cristián Rojas");
  assert.equal(normalizeDisplayName("ñ".repeat(64)), "ñ".repeat(64));
});

test("normalizeDisplayName rechaza vacío, más de 64 caracteres y caracteres de control", () => {
  for (const raw of ["", "   ", "x".repeat(65), "a\u0007b", "a\u007fb"])
    assert.equal(normalizeDisplayName(raw), undefined, JSON.stringify(raw));
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
  assert.equal(meetsMinVersion("0.44.0"), true);
  assert.equal(meetsMinVersion("0.44.1"), true);
  assert.equal(meetsMinVersion("0.100.0"), true);
  assert.equal(meetsMinVersion("1.0.0"), true);
  assert.equal(meetsMinVersion("0.43.9"), false);
  assert.equal(meetsMinVersion("0.9.99"), false);
});

test("meetsMinVersion devuelve false ante una versión ilegible", () => {
  for (const version of ["", "0.43", "v0.43.0", "abc", "0.43.x"])
    assert.equal(meetsMinVersion(version), false, version);
});
