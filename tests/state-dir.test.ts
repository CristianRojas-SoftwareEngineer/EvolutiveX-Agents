// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Resolución del state dir en los tres SO, incluyendo env vars ausentes.
// Dos de las tres ramas nunca se ejecutan en la máquina de desarrollo: se
// ejercitan falsificando process.platform (os.platform() lo refleja).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  stateDir,
  ensureStateDir,
  configPath,
  workerPidPath,
  queueDir,
  workerLogPath,
} from "../src/lib/state-dir.js";
import { fakePlatform, withEnv, makeTempDir, removeDir } from "./helpers.js";

const APP = "evolutivex-agents";

test("Windows: usa LOCALAPPDATA cuando está definida", () => {
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ LOCALAPPDATA: join("C:", "Perfil", "Local") });
  try {
    assert.equal(stateDir(), join("C:", "Perfil", "Local", APP));
  } finally {
    restoreE();
    restoreP();
  }
});

test("Windows: cae a <home>/AppData/Local si LOCALAPPDATA falta", () => {
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ LOCALAPPDATA: undefined });
  try {
    assert.equal(stateDir(), join(homedir(), "AppData", "Local", APP));
  } finally {
    restoreE();
    restoreP();
  }
});

test("macOS: usa Library/Application Support", () => {
  const restoreP = fakePlatform("darwin");
  try {
    assert.equal(
      stateDir(),
      join(homedir(), "Library", "Application Support", APP),
    );
  } finally {
    restoreP();
  }
});

test("Linux: usa XDG_STATE_HOME cuando está definida", () => {
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ XDG_STATE_HOME: join("/", "estado") });
  try {
    assert.equal(stateDir(), join("/", "estado", APP));
  } finally {
    restoreE();
    restoreP();
  }
});

test("Linux: cae a ~/.local/state si XDG_STATE_HOME falta", () => {
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ XDG_STATE_HOME: undefined });
  try {
    assert.equal(stateDir(), join(homedir(), ".local", "state", APP));
  } finally {
    restoreE();
    restoreP();
  }
});

test("las rutas derivadas cuelgan del state dir con sus nombres fijos", () => {
  assert.equal(configPath(), join(stateDir(), "config.json"));
  assert.equal(workerPidPath(), join(stateDir(), "worker.pid"));
  assert.equal(queueDir(), join(stateDir(), "queue"));
  assert.equal(workerLogPath(), join(stateDir(), "worker.log"));
});

test("ensureStateDir crea el directorio (recursivo) y devuelve su ruta", () => {
  const temp = makeTempDir();
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ XDG_STATE_HOME: join(temp, "anidado") });
  try {
    const dir = ensureStateDir();
    assert.equal(dir, join(temp, "anidado", APP));
    assert.ok(existsSync(dir));
  } finally {
    restoreE();
    restoreP();
    removeDir(temp);
  }
});
