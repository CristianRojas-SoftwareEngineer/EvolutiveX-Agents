// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Las preferencias llegan del userConfig del plugin como variables
// CLAUDE_PLUGIN_OPTION_* (solo las fijadas) y el secreto solo del entorno:
// defaults sin variables, valores fijados, valores inválidos tratados como no
// fijados e independencia de los dos canales.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/lib/config.js";
import { withEnv } from "./helpers.js";

const UNSET = {
  CLAUDE_PLUGIN_OPTION_VOICEENABLED: undefined,
  CLAUDE_PLUGIN_OPTION_NOTIFICATIONSENABLED: undefined,
  CLAUDE_PLUGIN_OPTION_MESSAGEMODE: undefined,
  CLAUDE_PLUGIN_OPTION_VOICE: undefined,
  GEMINI_API_KEY: undefined,
};

let restore: () => void;

beforeEach(() => {
  restore = withEnv(UNSET);
});

afterEach(() => {
  restore();
});

test("loadConfig sin variables devuelve los defaults", () => {
  const cfg = loadConfig();
  assert.equal(cfg.voiceEnabled, true);
  assert.equal(cfg.notificationsEnabled, true);
  assert.equal(cfg.messageMode, "local");
  assert.equal(cfg.voice, "default");
  assert.equal(cfg.geminiApiKey, undefined);
});

test("loadConfig trata la voz vacía o de solo espacios como default", () => {
  const undo = withEnv({ CLAUDE_PLUGIN_OPTION_VOICE: "   " });
  try {
    assert.equal(loadConfig().voice, "default");
  } finally {
    undo();
  }
});

test("loadConfig normaliza la voz fijada (recorte y minúsculas)", () => {
  const undo = withEnv({ CLAUDE_PLUGIN_OPTION_VOICE: "  Mi_Voz " });
  try {
    assert.equal(loadConfig().voice, "mi_voz");
  } finally {
    undo();
  }
});

test("loadConfig conserva un nombre de voz implausible sin sustituirlo por default", () => {
  const undo = withEnv({ CLAUDE_PLUGIN_OPTION_VOICE: "mi voz/../x" });
  try {
    assert.equal(loadConfig().voice, "mi voz/../x");
  } finally {
    undo();
  }
});

test("loadConfig respeta las opciones fijadas en /config", () => {
  const undo = withEnv({
    CLAUDE_PLUGIN_OPTION_VOICEENABLED: "false",
    CLAUDE_PLUGIN_OPTION_NOTIFICATIONSENABLED: "false",
    CLAUDE_PLUGIN_OPTION_MESSAGEMODE: "llm",
  });
  try {
    const cfg = loadConfig();
    assert.equal(cfg.voiceEnabled, false);
    assert.equal(cfg.notificationsEnabled, false);
    assert.equal(cfg.messageMode, "llm");
  } finally {
    undo();
  }
});

test("loadConfig trata un valor inválido como el valor por defecto", () => {
  const undo = withEnv({
    CLAUDE_PLUGIN_OPTION_VOICEENABLED: "no",
    CLAUDE_PLUGIN_OPTION_NOTIFICATIONSENABLED: "",
    CLAUDE_PLUGIN_OPTION_MESSAGEMODE: "turbo",
  });
  try {
    const cfg = loadConfig();
    assert.equal(cfg.voiceEnabled, true);
    assert.equal(cfg.notificationsEnabled, true);
    assert.equal(cfg.messageMode, "local");
  } finally {
    undo();
  }
});

test("los controles de notificaciones y narración por voz son independientes", () => {
  const undo = withEnv({ CLAUDE_PLUGIN_OPTION_VOICEENABLED: "false" });
  try {
    assert.equal(loadConfig().voiceEnabled, false);
    assert.equal(loadConfig().notificationsEnabled, true);
  } finally {
    undo();
  }
});

test("loadConfig lee la API key solo de GEMINI_API_KEY", () => {
  const undo = withEnv({
    GEMINI_API_KEY: "del-entorno",
    CLAUDE_PLUGIN_OPTION_GEMINIAPIKEY: "de-userconfig",
  });
  try {
    assert.equal(loadConfig().geminiApiKey, "del-entorno");
  } finally {
    undo();
  }
});

test("una env var vacía o de solo espacios no configura la clave", () => {
  const undo = withEnv({ GEMINI_API_KEY: "   " });
  try {
    assert.equal(loadConfig().geminiApiKey, undefined);
  } finally {
    undo();
  }
});
