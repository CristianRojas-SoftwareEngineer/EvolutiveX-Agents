// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// `daemon status --json` contra el contrato v0.36.2 (CONTRACT.md tabla por comando): clave
// `daemon` como cadena ("running"|"stopped"), `degraded` opcional
// (unresponsive|unregistered|orphan_resident) y `warm` opcional
// (warming|warm|warm_failed); exit 0, 1 (`daemon_error`) o 5 (`daemon_unreachable`). getDaemonStatus devuelve un
// resultado discriminado (running|stopped|degraded|uncertain) que conserva exit
// y JSON. Usa un shim `ai-voice-interconnector` falso en disco, invocado por su
// ruta directa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as daemon from "../src/lib/daemon.js";
import { makeTempDir, removeDir } from "./helpers.js";

/**
 * Crea un `ai-voice-interconnector` falso en un temporal que imprime
 * `statusJson` ante `daemon status` y sale con `exitCode`. Devuelve la ruta al
 * ejecutable (shim .cmd en Windows, script sh en Unix, ambos delegando en un
 * impl Node) y un limpiador.
 */
function makeFakeCli(
  statusJson: string,
  exitCode = 0,
): { cliPath: string; cleanup: () => void } {
  const dir = makeTempDir("narrator-daemon-cli-");
  writeFileSync(join(dir, "status.json"), statusJson);
  writeFileSync(join(dir, "status.exit"), String(exitCode));
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'if (argv[0] === "daemon" && argv[1] === "status") {',
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "status.json"), "utf8"));',
      '  process.exit(Number(fs.readFileSync(path.join(__dirname, "status.exit"), "utf8")));',
      "}",
      "process.exit(0);",
    ].join("\n"),
  );
  let cliPath: string;
  if (process.platform === "win32") {
    cliPath = join(dir, "ai-voice-interconnector.cmd");
    writeFileSync(
      cliPath,
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    cliPath = join(dir, "ai-voice-interconnector");
    // ${0%/*} es expansión de parámetros POSIX (built-in del shell): resuelve
    // el dir del shim sin invocar el binario externo `dirname`, que no está en
    // el PATH acotado del test (solo shim + Node). Con `dirname` los runners
    // POSIX de CI fallaban con «dirname: not found».
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return { cliPath, cleanup: () => removeDir(dir) };
}

test("running con warm warming ⇒ running, conserva warm, pid y exit 0", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({
      schema_version: "5",
      daemon: "running",
      pid: 1234,
      engine: "rust_native",
      warm: "warming",
    }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "running");
    assert.equal(result.exitCode, 0);
    assert.equal(result.warm, "warming");
    assert.equal(
      (result.raw as { daemon?: string } | undefined)?.daemon,
      "running",
    );
  } finally {
    cleanup();
  }
});

test("running con warm warm ⇒ running con warm preservado", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ schema_version: "5", daemon: "running", warm: "warm" }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "running");
    assert.equal(result.warm, "warm");
  } finally {
    cleanup();
  }
});

test("running con warm warm_failed ⇒ running con warm_failed preservado", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({
      schema_version: "5",
      daemon: "running",
      warm: "warm_failed",
    }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "running");
    assert.equal(result.warm, "warm_failed");
  } finally {
    cleanup();
  }
});

test("running sin warm ⇒ ausencia del campo no es fallo", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ schema_version: "5", daemon: "running", pid: 42 }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "running");
    assert.equal(result.warm, undefined);
    assert.equal(result.exitCode, 0);
  } finally {
    cleanup();
  }
});

test('stopped limpio: {"daemon":"stopped"} ⇒ stopped sin degraded', () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ schema_version: "5", daemon: "stopped" }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "stopped");
    assert.equal(result.exitCode, 0);
    assert.equal(result.degraded, undefined);
  } finally {
    cleanup();
  }
});

test("stopped + degraded unresponsive ⇒ degraded conserva el código", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({
      schema_version: "5",
      daemon: "stopped",
      degraded: "unresponsive",
    }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "degraded");
    assert.equal(result.degraded, "unresponsive");
    assert.equal(result.exitCode, 0);
  } finally {
    cleanup();
  }
});

test("stopped + degraded unregistered ⇒ degraded conserva el código", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({
      schema_version: "5",
      daemon: "stopped",
      degraded: "unregistered",
    }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "degraded");
    assert.equal(result.degraded, "unregistered");
  } finally {
    cleanup();
  }
});

test("stopped + degraded orphan_resident ⇒ degraded conserva el código", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({
      schema_version: "5",
      daemon: "stopped",
      degraded: "orphan_resident",
    }),
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "degraded");
    assert.equal(result.degraded, "orphan_resident");
  } finally {
    cleanup();
  }
});

test("binario inexistente ⇒ uncertain, sin exit que conservar", () => {
  const dir = makeTempDir("narrator-daemon-none-");
  try {
    const result = daemon.getDaemonStatus(join(dir, "no-existe"));
    assert.equal(result.kind, "uncertain");
    assert.equal(result.exitCode, null);
  } finally {
    removeDir(dir);
  }
});

test("stdout vacío ⇒ uncertain", () => {
  const { cliPath, cleanup } = makeFakeCli("");
  try {
    assert.equal(daemon.getDaemonStatus(cliPath).kind, "uncertain");
  } finally {
    cleanup();
  }
});

test("JSON inválido ⇒ uncertain", () => {
  const { cliPath, cleanup } = makeFakeCli("esto no es json");
  try {
    assert.equal(daemon.getDaemonStatus(cliPath).kind, "uncertain");
  } finally {
    cleanup();
  }
});

test('objeto sin campo daemon válido (p. ej. {"running":true}) ⇒ uncertain, nunca running', () => {
  const { cliPath, cleanup } = makeFakeCli(JSON.stringify({ running: true }));
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "uncertain");
  } finally {
    cleanup();
  }
});

test('estado desconocido {"daemon":"banana"} ⇒ uncertain', () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ schema_version: "5", daemon: "banana" }),
  );
  try {
    assert.equal(daemon.getDaemonStatus(cliPath).kind, "uncertain");
  } finally {
    cleanup();
  }
});

test("exit no cero con JSON running ⇒ uncertain (combinación incoherente), exit conservado", () => {
  const { cliPath, cleanup } = makeFakeCli(
    JSON.stringify({ schema_version: "5", daemon: "running" }),
    1,
  );
  try {
    const result = daemon.getDaemonStatus(cliPath);
    assert.equal(result.kind, "uncertain");
    assert.equal(result.exitCode, 1);
  } finally {
    cleanup();
  }
});
