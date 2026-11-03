// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Resolución del binario ai-voice-interconnector en el PATH, con la lógica condicional
// por SO (PATHEXT en Windows) que es fácil de romper sin notar desde una sola
// plataforma de desarrollo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  resolveCli,
  needsShell,
  buildShellCommand,
} from "../src/voice/resolve-cli.js";
import { fakePlatform, withEnv, makeTempDir, removeDir } from "./helpers.js";

function makeBinDir(...fileNames: string[]): string {
  const dir = makeTempDir("avi-plugin-bin-");
  for (const name of fileNames) {
    writeFileSync(join(dir, name), "#!/bin/sh\n");
  }
  return dir;
}

test("POSIX: encuentra el binario ai-voice-interconnector en el PATH", () => {
  const bin = makeBinDir("ai-voice-interconnector");
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ PATH: bin });
  try {
    assert.equal(resolveCli(), join(bin, "ai-voice-interconnector"));
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("POSIX: devuelve undefined si el CLI no está en el PATH", () => {
  const bin = makeBinDir();
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ PATH: bin });
  try {
    assert.equal(resolveCli(), undefined);
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("POSIX: respeta el orden del PATH", () => {
  const primero = makeBinDir("ai-voice-interconnector");
  const segundo = makeBinDir("ai-voice-interconnector");
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({ PATH: [primero, segundo].join(delimiter) });
  try {
    assert.equal(resolveCli(), join(primero, "ai-voice-interconnector"));
  } finally {
    restoreE();
    restoreP();
    removeDir(primero);
    removeDir(segundo);
  }
});

test("POSIX: un directorio inexistente en el PATH no rompe la búsqueda", () => {
  const bin = makeBinDir("ai-voice-interconnector");
  const restoreP = fakePlatform("linux");
  const restoreE = withEnv({
    PATH: [join(bin, "no-existe"), bin].join(delimiter),
  });
  try {
    assert.equal(resolveCli(), join(bin, "ai-voice-interconnector"));
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("Windows: resuelve el .exe respetando el orden de PATHEXT", () => {
  const bin = makeBinDir(
    "ai-voice-interconnector.exe",
    "ai-voice-interconnector.cmd",
  );
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ PATH: bin, PATHEXT: ".EXE;.CMD;.BAT" });
  try {
    assert.equal(resolveCli(), join(bin, "ai-voice-interconnector.exe"));
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("Windows: encuentra el shim .cmd si no hay .exe", () => {
  const bin = makeBinDir("ai-voice-interconnector.cmd");
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ PATH: bin, PATHEXT: ".EXE;.CMD;.BAT" });
  try {
    assert.equal(resolveCli(), join(bin, "ai-voice-interconnector.cmd"));
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("Windows: usa las extensiones por defecto si PATHEXT falta", () => {
  const bin = makeBinDir("ai-voice-interconnector.exe");
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ PATH: bin, PATHEXT: undefined });
  try {
    assert.equal(resolveCli(), join(bin, "ai-voice-interconnector.exe"));
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("Windows: ignora entradas que son directorios, no archivos", () => {
  const bin = makeTempDir("avi-plugin-bin-");
  mkdirSync(join(bin, "ai-voice-interconnector.exe"));
  const restoreP = fakePlatform("win32");
  const restoreE = withEnv({ PATH: bin, PATHEXT: ".EXE" });
  try {
    assert.equal(resolveCli(), undefined);
  } finally {
    restoreE();
    restoreP();
    removeDir(bin);
  }
});

test("needsShell: true solo para shims .cmd/.bat en Windows", () => {
  const restoreP = fakePlatform("win32");
  try {
    assert.equal(needsShell("C:\\bin\\ai-voice-interconnector.CMD"), true);
    assert.equal(needsShell("C:\\bin\\ai-voice-interconnector.bat"), true);
    assert.equal(needsShell("C:\\bin\\ai-voice-interconnector.exe"), false);
  } finally {
    restoreP();
  }
});

test("needsShell: siempre false fuera de Windows", () => {
  const restoreP = fakePlatform("linux");
  try {
    assert.equal(needsShell("/usr/bin/ai-voice-interconnector.cmd"), false);
  } finally {
    restoreP();
  }
});

test("buildShellCommand: no cita tokens sin espacios ni metacaracteres", () => {
  assert.equal(
    buildShellCommand("C:\\bin\\avi.cmd", ["daemon", "status", "--json"]),
    "C:\\bin\\avi.cmd daemon status --json",
  );
});

test("buildShellCommand: cita la ruta del shim con espacios", () => {
  assert.equal(
    buildShellCommand("C:\\Program Files\\avi\\avi.cmd", ["daemon", "start"]),
    '"C:\\Program Files\\avi\\avi.cmd" daemon start',
  );
});

test("buildShellCommand: cita argumentos con espacios o metacaracteres de cmd.exe", () => {
  assert.equal(
    buildShellCommand("avi.cmd", [
      "speech",
      "say",
      "--text",
      "hola mundo & ya",
    ]),
    'avi.cmd speech say --text "hola mundo & ya"',
  );
});

test("buildShellCommand: dobla las comillas internas de un argumento", () => {
  assert.equal(
    buildShellCommand("avi.cmd", ["--text", 'di "hola"']),
    'avi.cmd --text "di ""hola"""',
  );
});
