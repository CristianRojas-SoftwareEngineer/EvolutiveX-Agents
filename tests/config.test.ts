// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Las preferencias viven en config.json y el secreto solo en el entorno:
// defaults, invariante de seguridad (la clave nunca se lee ni se escribe en el
// archivo), tolerancia a archivo
// ausente/corrupto y merge parcial de updateConfig.
// El state dir se aísla en un temporal (ver helpers) para no tocar el real.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/lib/config.js";
import { configPath } from "../src/lib/state-dir.js";
import { isolateStateDir } from "./helpers.js";

let state: ReturnType<typeof isolateStateDir>;

beforeEach(() => {
  state = isolateStateDir();
});

afterEach(() => {
  state.restore();
});

function writeConfigFile(contents: string): void {
  mkdirSync(join(state.dir, "evolutivex-agent"), { recursive: true });
  writeFileSync(configPath(), contents);
}

test("loadConfig sin archivo ni env devuelve los defaults", () => {
  const cfg = loadConfig();
  assert.equal(cfg.voiceEnabled, true);
  assert.equal(cfg.notificationsEnabled, true);
  assert.equal(cfg.messageMode, "local");
  assert.equal(cfg.geminiApiKey, undefined);
});

test("loadConfig lee las preferencias del archivo", () => {
  writeConfigFile(JSON.stringify({ voiceEnabled: false, messageMode: "llm" }));
  const cfg = loadConfig();
  assert.equal(cfg.voiceEnabled, false);
  assert.equal(cfg.messageMode, "llm");
});

test("loadConfig ignora las claves presentes en el archivo", () => {
  writeConfigFile(
    JSON.stringify({
      voiceEnabled: false,
      messageMode: "llm",
      geminiApiKey: "clave-en-archivo",
    }),
  );
  const cfg = loadConfig();
  assert.equal(cfg.voiceEnabled, false);
  assert.equal(cfg.messageMode, "llm");
  assert.equal(cfg.geminiApiKey, undefined);
});

test("loadConfig ignora un archivo con JSON inválido y usa defaults", () => {
  writeConfigFile("{corrupto");
  const cfg = loadConfig();
  assert.equal(cfg.voiceEnabled, true);
  assert.equal(cfg.messageMode, "local");
});

test("loadConfig normaliza un messageMode desconocido a local", () => {
  writeConfigFile(JSON.stringify({ messageMode: "otro" }));
  assert.equal(loadConfig().messageMode, "local");
});

test("loadConfig lee la API key solo del entorno", () => {
  writeConfigFile(JSON.stringify({ geminiApiKey: "clave-en-archivo" }));
  process.env.GEMINI_API_KEY = "del-entorno";
  assert.equal(loadConfig().geminiApiKey, "del-entorno");
});

test("una env var vacía o de solo espacios no configura la clave", () => {
  process.env.GEMINI_API_KEY = "   ";
  assert.equal(loadConfig().geminiApiKey, undefined);
});

test("updateConfig escribe solo preferencias y nunca persiste una clave presente en el archivo", () => {
  writeConfigFile(JSON.stringify({ geminiApiKey: "clave-en-archivo" }));
  updateConfig({ messageMode: "llm" });
  const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(raw).sort(), [
    "messageMode",
    "notificationsEnabled",
    "voiceEnabled",
  ]);
  assert.equal(raw.voiceEnabled, true);
  assert.equal(raw.messageMode, "llm");
});

test("updateConfig hace merge parcial de preferencias", () => {
  updateConfig({ messageMode: "llm" });
  updateConfig({ voiceEnabled: false });
  const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(raw.voiceEnabled, false);
  assert.equal(raw.messageMode, "llm");
});

test("updateConfig crea el state dir si no existe y devuelve la config efectiva", () => {
  const cfg = updateConfig({ voiceEnabled: false });
  assert.equal(cfg.voiceEnabled, false);
  assert.equal(cfg.messageMode, "local");
});

test("los controles de notificaciones y narración por voz son independientes", () => {
  updateConfig({ notificationsEnabled: true });
  updateConfig({ voiceEnabled: false });
  assert.equal(loadConfig().notificationsEnabled, true);
  assert.equal(loadConfig().voiceEnabled, false);
  updateConfig({ notificationsEnabled: false });
  updateConfig({ voiceEnabled: true });
  assert.equal(loadConfig().notificationsEnabled, false);
  assert.equal(loadConfig().voiceEnabled, true);
});
