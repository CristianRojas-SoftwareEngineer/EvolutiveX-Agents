// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// La superficie que invoca la skill: cada subcomando de narrate-ctl como
// subproceso real sobre dist/narrate-ctl.js (check-dist garantiza que dist/
// refleja src/), con el state dir redirigido a un temporal vía env vars del SO
// anfitrión. El test de status fija por contrato que las claves jamás se
// imprimen. Cubre presynth idempotente y presynth --force (que pasa --force al
// motor para reescribir los WAV existentes).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { makeTempDir, removeDir } from "./helpers.js";
import { ANNOUNCEMENTS } from "../src/message/static-announcements.js";

const CTL = join(process.cwd(), "dist", "narrate-ctl.js");

let stateBase: string;

beforeEach(() => {
  stateBase = makeTempDir("avi-plugin-ctl-");
});

afterEach(() => {
  removeDir(stateBase);
});

/** Env que redirige el state dir al temporal según el SO real del host. */
function ctlEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  Object.assign(env, extra);
  if (process.platform === "win32") env.LOCALAPPDATA = stateBase;
  else if (process.platform === "darwin") env.HOME = stateBase;
  else env.XDG_STATE_HOME = stateBase;
  return env;
}

function runCtl(
  args: string[],
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CTL, ...args], {
    env: ctlEnv(extraEnv),
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function readConfigFile(): Record<string, unknown> {
  const sub =
    process.platform === "darwin" ? join("Library", "Application Support") : "";
  const path = join(stateBase, sub, "evolutivex-agent", "config.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("voice-on activa la narración y lo persiste", () => {
  const res = runCtl(["voice-on"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /activada/);
  assert.equal(readConfigFile().voiceEnabled, true);
});

test("voice-off desactiva la narración y lo persiste", () => {
  const res = runCtl(["voice-off"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /desactivada/);
  assert.equal(readConfigFile().voiceEnabled, false);
});

test("notifications-off y notifications-on controlan las notificaciones sin alterar voz", () => {
  assert.equal(runCtl(["notifications-off"]).status, 0);
  assert.equal(readConfigFile().notificationsEnabled, false);
  assert.equal(readConfigFile().voiceEnabled, true);
  assert.equal(runCtl(["notifications-on"]).status, 0);
  assert.equal(readConfigFile().notificationsEnabled, true);
});

test("mode fija llm o local; un valor inválido devuelve 2 con uso", () => {
  assert.equal(runCtl(["mode", "local"]).status, 0);
  assert.equal(readConfigFile().messageMode, "local");
  assert.equal(runCtl(["mode", "llm"]).status, 0);
  assert.equal(readConfigFile().messageMode, "llm");

  const bad = runCtl(["mode", "turbo"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Uso: mode/);
});

test("status reporta el estado y jamás imprime el valor de una clave", () => {
  const sentinel = "sk-CLAVE-QUE-NO-DEBE-APARECER";
  const res = runCtl(["status"], { GEMINI_API_KEY: sentinel });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /voice:/);
  assert.match(res.stdout, /notifications:/);
  assert.match(res.stdout, /messageMode: {4}local/);
  assert.match(res.stdout, /gemini key: {5}configurada/);
  assert.ok(!res.stdout.includes(sentinel));
  assert.ok(!res.stderr.includes(sentinel));
});

test("status sin GEMINI_API_KEY reporta la clave ausente", () => {
  const res = runCtl(["status"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /messageMode: {4}local/);
  assert.match(res.stdout, /gemini key: {5}ausente/);
});

test("config.json solo persiste preferencias no secretas", () => {
  assert.equal(runCtl(["voice-on"]).status, 0);
  assert.equal(runCtl(["mode", "llm"]).status, 0);
  assert.equal(runCtl(["voice-off"]).status, 0);
  const raw = readConfigFile();
  assert.deepEqual(Object.keys(raw).sort(), [
    "messageMode",
    "notificationsEnabled",
    "voiceEnabled",
  ]);
  assert.equal(raw.voiceEnabled, false);
  assert.equal(raw.messageMode, "llm");
});

test("sin comando equivale a status", () => {
  const res = runCtl([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /voice:/);
});

test("un comando desconocido devuelve 2", () => {
  const res = runCtl(["bailar"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Comando desconocido/);
});

test("say sin texto devuelve 2 con uso", () => {
  const res = runCtl(["say", "   "]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Uso: say/);
});

test("say sin ai-voice-interconnector en el PATH devuelve 1 con aviso", () => {
  const emptyPath = makeTempDir("avi-plugin-empty-");
  try {
    const res = runCtl(["say", "hola"], { PATH: emptyPath, Path: emptyPath });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no está en el PATH/);
  } finally {
    removeDir(emptyPath);
  }
});

// --- CLI falso: registra argv por invocación y sale con códigos de una secuencia ---

/**
 * Crea un `ai-voice-interconnector` falso en `dir` (shim .cmd en Windows, script sh en
 * Unix, ambos delegando en un impl Node). Cada invocación anota su argv en
 * `argv.log` y consume el siguiente código de la secuencia (0 si se agota).
 */
function makeFakeCli(dir: string, codes: number[]): { argvLog: string } {
  const argvLog = join(dir, "argv.log");
  writeFileSync(join(dir, "seq.json"), JSON.stringify(codes));
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(process.argv.slice(2)) + "\\n");',
      'const seqPath = path.join(__dirname, "seq.json");',
      'const codes = JSON.parse(fs.readFileSync(seqPath, "utf8"));',
      "const code = codes.length ? codes.shift() : 0;",
      "fs.writeFileSync(seqPath, JSON.stringify(codes));",
      "process.exit(code);",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, "ai-voice-interconnector.cmd"),
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    const sh = join(dir, "ai-voice-interconnector");
    // ${0%/*} es expansión de parámetros POSIX (built-in del shell): resuelve
    // el dir del shim sin invocar el binario externo `dirname`, que no está en
    // el PATH acotado del test (solo shim + Node). Con `dirname` los runners
    // POSIX de CI fallaban con «dirname: not found».
    writeFileSync(sh, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(sh, 0o755);
  }
  return { argvLog };
}

/** PATH que resuelve el CLI falso y mantiene `node` disponible para el shim. */
function fakeCliEnv(dir: string): Record<string, string> {
  const p = dir + delimiter + dirname(process.execPath);
  return { PATH: p, Path: p };
}

function loggedArgvs(argvLog: string): string[][] {
  return readFileSync(argvLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}

test("say invoca speech say --text --daemon (contrato §12)", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0]);
    const res = runCtl(["say", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    const [argv] = loggedArgvs(argvLog);
    assert.deepEqual(argv.slice(0, 3), ["speech", "say", "--text"]);
    assert.ok(argv.includes("--daemon"));
  } finally {
    removeDir(dir);
  }
});

test("presynth pre-sintetiza los seis anuncios con speech synthesize --label --daemon", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: pre-sintetizado /g)?.length, 6);

    const argvs = loggedArgvs(argvLog);
    assert.equal(argvs.length, 6);
    const labels = argvs.map((argv) => {
      assert.deepEqual(argv.slice(0, 2), ["speech", "synthesize"]);
      assert.ok(argv.includes("--daemon"));
      assert.ok(!argv.includes("--force"));
      return argv[argv.indexOf("--label") + 1];
    });
    assert.deepEqual(
      labels.sort(),
      Object.values(ANNOUNCEMENTS)
        .map((a) => a.label)
        .sort(),
    );
  } finally {
    removeDir(dir);
  }
});

test("presynth --force pasa --force al motor y reporta re-sintetizado", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
    const res = runCtl(["presynth", "--force"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: re-sintetizado /g)?.length, 6);

    const argvs = loggedArgvs(argvLog);
    assert.equal(argvs.length, 6);
    for (const argv of argvs) {
      assert.deepEqual(argv.slice(0, 2), ["speech", "synthesize"]);
      assert.ok(argv.includes("--force"));
      assert.ok(argv.includes("--daemon"));
    }
  } finally {
    removeDir(dir);
  }
});

test("presynth con un argumento inválido devuelve 2 con uso", () => {
  const res = runCtl(["presynth", "turbo"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Uso: presynth/);
});

test("presynth es idempotente: exit 6 (label ya existe) cuenta como éxito", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [0, 6, 6, 0, 6, 6]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: ya pre-sintetizado /g)?.length, 4);
    assert.equal(res.stdout.match(/: pre-sintetizado /g)?.length, 2);
  } finally {
    removeDir(dir);
  }
});

test("presynth propaga el fallo (exit 5, daemon caído) con código ≠ 0", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [5, 0, 0, 0, 0, 0]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /exit 5/);
    assert.match(res.stderr, /daemon caído/);
  } finally {
    removeDir(dir);
  }
});

test("presynth sin ai-voice-interconnector en el PATH devuelve 1 con aviso", () => {
  const emptyPath = makeTempDir("avi-plugin-empty-");
  try {
    const res = runCtl(["presynth"], { PATH: emptyPath, Path: emptyPath });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no está en el PATH/);
  } finally {
    removeDir(emptyPath);
  }
});
