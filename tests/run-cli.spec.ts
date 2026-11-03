// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// runCliWithTimeout acota la invocación del CLI y mata su árbol al exceder el
// timeout. Usa un CLI falso que duerme más que el timeout.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { runCliWithTimeout } from "../src/voice/resolve-cli.js";
import { makeTempDir, removeDir } from "./helpers.js";

let restoreDirs: string[] = [];

afterEach(() => {
  for (const d of restoreDirs) removeDir(d);
  restoreDirs = [];
});

function makeSleepingCli(ms: number): string {
  const dir = makeTempDir("avi-plugin-sleep-cli-");
  restoreDirs.push(dir);
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const ms = Number(fs.readFileSync(__dirname + "/sleep.ms", "utf8"));',
      `const start = Date.now();`,
      `while (Date.now() - start < ms) {}`, // bucle activo para bloquear sin depender de setTimeout del child
      "process.exit(0);",
    ].join("\n"),
  );
  writeFileSync(join(dir, "sleep.ms"), String(ms));
  const cliPath = join(dir, "ai-voice-interconnector");
  if (process.platform === "win32") {
    writeFileSync(
      cliPath + ".cmd",
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return cliPath + (process.platform === "win32" ? ".cmd" : "");
}

/** CLI falso que imprime `output` por stdout y sale con `exitCode`. */
function makeEchoCli(output: string, exitCode: number): string {
  const dir = makeTempDir("avi-plugin-echo-cli-");
  restoreDirs.push(dir);
  writeFileSync(join(dir, "out.txt"), output);
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'process.stdout.write(fs.readFileSync(__dirname + "/out.txt", "utf8"));',
      // exitCode en lugar de exit(): no trunca la tubería antes de drenarla
      `process.exitCode = ${exitCode};`,
    ].join("\n"),
  );
  const cliPath = join(dir, "ai-voice-interconnector");
  if (process.platform === "win32") {
    writeFileSync(
      cliPath + ".cmd",
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return cliPath + (process.platform === "win32" ? ".cmd" : "");
}

test("runCliWithTimeout devuelve timedOut cuando el CLI excede el timeout", async () => {
  const cli = makeSleepingCli(10_000); // duerme 10 s
  const start = Date.now();
  const res = await runCliWithTimeout(cli, [], {
    windowsHide: true,
    timeoutMs: 100, // 100 ms
    killGraceMs: 500,
  });
  const elapsed = Date.now() - start;
  assert.equal(res.timedOut, true);
  assert.ok(elapsed < 3000, `debe resolver rápido, tardó ${elapsed} ms`);
  assert.ok(res.code === null || res.signal !== null);
  assert.equal(typeof res.stdout, "string");
});

test("runCliWithTimeout resuelve normalmente si el CLI termina antes del timeout", async () => {
  const cli = makeSleepingCli(50); // duerme 50 ms
  const res = await runCliWithTimeout(cli, [], {
    windowsHide: true,
    timeoutMs: 5000,
    killGraceMs: 500,
  });
  assert.equal(res.timedOut, false);
  assert.equal(res.code, 0);
});

test("runCliWithTimeout devuelve el stdout y el código del CLI", async () => {
  const output = '{"error":"x","reason":"speech_not_found"}';
  const cli = makeEchoCli(output, 3);
  const res = await runCliWithTimeout(cli, [], {
    windowsHide: true,
    timeoutMs: 5000,
  });
  assert.equal(res.code, 3);
  assert.equal(res.timedOut, false);
  assert.equal(res.stdout.trim(), output);
});

test("runCliWithTimeout acota el stdout capturado a 64 KiB", async () => {
  const output = "a".repeat(100 * 1024);
  const cli = makeEchoCli(output, 0);
  const res = await runCliWithTimeout(cli, [], {
    windowsHide: true,
    timeoutMs: 5000,
  });
  assert.equal(res.code, 0);
  assert.equal(res.stdout.length, 64 * 1024);
});
