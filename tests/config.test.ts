// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Las preferencias viven en config.json y el secreto solo en el entorno:
// defaults, lectura de archivo sin claves, tolerancia a archivo
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
  mkdirSync(join(state.dir, "agent-voice-interconnector"), { recursive: true });
  writeFileSync(configPath(), contents);
}

test("loadConfig sin archivo ni env devuelve los defaults", () => {
  const cfg = loadConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.desktopEnabled, true);
  assert.equal(cfg.messageMode, "local");
  assert.equal(cfg.geminiApiKey, undefined);
});

test("loadConfig lee las preferencias del archivo", () => {
  writeConfigFile(JSON.stringify({ enabled: false, messageMode: "llm" }));
  const cfg = loadConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.messageMode, "llm");
});

test("loadConfig ignora las claves presentes en el archivo", () => {
  writeConfigFile(
    JSON.stringify({
      enabled: false,
      messageMode: "llm",
      geminiApiKey: "clave-archivo",
      openRouterApiKey: "clave-archivo",
    }),
  );
  const cfg = loadConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.messageMode, "llm");
  assert.equal(cfg.geminiApiKey, undefined);
  assert.equal("openRouterApiKey" in cfg, false);
});

test("loadConfig ignora un archivo con JSON inválido y usa defaults", () => {
  writeConfigFile("{corrupto");
  const cfg = loadConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.messageMode, "local");
});

test("loadConfig normaliza un messageMode desconocido a local", () => {
  writeConfigFile(JSON.stringify({ messageMode: "otro" }));
  assert.equal(loadConfig().messageMode, "local");
});

test("loadConfig lee la API key solo del entorno", () => {
  writeConfigFile(JSON.stringify({ geminiApiKey: "del-archivo" }));
  process.env.GEMINI_API_KEY = "del-entorno";
  assert.equal(loadConfig().geminiApiKey, "del-entorno");
});

test("una env var vacía o de solo espacios no configura la clave", () => {
  process.env.GEMINI_API_KEY = "   ";
  assert.equal(loadConfig().geminiApiKey, undefined);
});

test("updateConfig escribe solo preferencias y descarta claves del archivo", () => {
  writeConfigFile(
    JSON.stringify({ geminiApiKey: "clave-vieja", openRouterApiKey: "vieja" }),
  );
  updateConfig({ messageMode: "llm" });
  const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(raw).sort(), [
    "desktopEnabled",
    "enabled",
    "messageMode",
  ]);
  assert.equal(raw.enabled, true);
  assert.equal(raw.messageMode, "llm");
});

test("updateConfig hace merge parcial de preferencias", () => {
  updateConfig({ messageMode: "llm" });
  updateConfig({ enabled: false });
  const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(raw.enabled, false);
  assert.equal(raw.messageMode, "llm");
});

test("updateConfig crea el state dir si no existe y devuelve la config efectiva", () => {
  const cfg = updateConfig({ enabled: false });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.messageMode, "local");
});

test("los controles de escritorio y narración son independientes", () => {
  updateConfig({ desktopEnabled: true });
  updateConfig({ enabled: false });
  assert.equal(loadConfig().desktopEnabled, true);
  assert.equal(loadConfig().enabled, false);
  updateConfig({ desktopEnabled: false });
  updateConfig({ enabled: true });
  assert.equal(loadConfig().desktopEnabled, false);
  assert.equal(loadConfig().enabled, true);
});
