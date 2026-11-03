// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Worker drenador: verifica que narra los payloads encolados en orden, sin
// duplicados y con la voz anotada en cada ítem (`--voice`), que sale tras la
// ventana de inactividad y que rota worker.log por tamaño y antigüedad. Usa
// dist/narrate-worker.js como subproceso real con un CLI falso y state dir
// aislado.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  chmodSync,
  readFileSync,
  existsSync,
  statSync,
  utimesSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { enqueuePayload, listPending } from "../src/voice/queue.js";
import {
  ensureStateDir,
  rotatedWorkerLogPath,
  workerLogPath,
  workerPidPath,
} from "../src/lib/state-dir.js";
import { withEnv, makeTempDir, removeDir } from "./helpers.js";

const WORKER = join(process.cwd(), "dist", "narrate-worker.js");

let restoreDirs: string[] = [];
let restoreEnv: () => void;

afterEach(() => {
  for (const d of restoreDirs) removeDir(d);
  restoreDirs = [];
  if (restoreEnv) restoreEnv();
});

/**
 * CLI falso que anota su argv en `argv.log`. Con `responses`, la invocación
 * i-ésima (contador en disco) imprime `stdout` y sale con `exit`; sin respuesta
 * para ese índice, sale con 0.
 */
function makeFakeCli(
  dir: string,
  responses: Array<{ stdout: string; exit: number }> = [],
): string {
  if (responses.length > 0) {
    writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
  }
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "(function () {",
      "  const argv = process.argv.slice(2);",
      '  fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
      '  const responsesPath = path.join(__dirname, "responses.json");',
      "  if (fs.existsSync(responsesPath)) {",
      '    const counterPath = path.join(__dirname, "counter");',
      '    const i = fs.existsSync(counterPath) ? Number(fs.readFileSync(counterPath, "utf8")) : 0;',
      "    fs.writeFileSync(counterPath, String(i + 1));",
      '    const r = JSON.parse(fs.readFileSync(responsesPath, "utf8"))[i];',
      "    if (r) {",
      "      process.stdout.write(r.stdout);",
      "      process.exitCode = r.exit;",
      "      return;",
      "    }",
      "  }",
      "  process.exitCode = 0;",
      "})();",
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
    writeFileSync(cliPath, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(cliPath, 0o755);
  }
  return cliPath;
}

function runWorker(env: NodeJS.ProcessEnv): { status: number | null } {
  const res = spawnSync(process.execPath, [WORKER], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  return { status: res.status };
}

test("worker narra dos payloads encolados en orden, sin duplicados y con la voz de cada ítem", () => {
  const dir = makeTempDir("avi-plugin-worker-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  // Aislar state dir en `dir` tanto para el proceso padre como para el subproceso
  // worker en el SO anfitrión real (win32: LOCALAPPDATA, darwin: HOME, linux: XDG_STATE_HOME).
  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  // Encolar dos payloads directamente en la cola del state dir aislado.
  enqueuePayload(
    {
      session_id: "s1",
      hook_event_name: "UserPromptSubmit",
      prompt: "primero",
    },
    "mi_voz",
  );
  enqueuePayload(
    {
      session_id: "s2",
      hook_event_name: "Stop",
      last_assistant_message: "segundo",
    },
    "default",
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);

  const calls = readFileSync(join(cliDir, "argv.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(calls.length, 2, "debe invocar el CLI exactamente dos veces");
  assert.deepEqual(calls[0]!.slice(0, 3), ["speech", "play", "--label"]);
  assert.deepEqual(calls[0]!.slice(4), ["--voice", "mi_voz", "--json"]);
  assert.deepEqual(calls[1], [
    "speech",
    "say",
    "--text",
    "segundo",
    "--voice",
    "default",
    "--daemon",
    "--json",
  ]);
});

test("worker sale tras la ventana de inactividad y deja la cola vacía", () => {
  const dir = makeTempDir("avi-plugin-worker-empty-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-empty-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);
});

test("worker recupera lock huérfano (PID muerto en worker.pid) y drena la cola", () => {
  const dir = makeTempDir("avi-plugin-worker-stale-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-stale-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  ensureStateDir();
  writeFileSync(workerPidPath(), "999999", "utf8");
  enqueuePayload(
    {
      session_id: "s-stale",
      hook_event_name: "Stop",
      last_assistant_message: "recuperado tras caída",
    },
    "default",
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);
  assert.equal(existsSync(workerPidPath()), false);
  assert.equal(listPending().length, 0);

  const calls = readFileSync(join(cliDir, "argv.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "speech",
    "say",
    "--text",
    "recuperado tras caída",
    "--voice",
    "default",
    "--daemon",
    "--json",
  ]);
});

test("worker respeta lock activo (PID vivo en worker.pid) y sale sin drenar", () => {
  const dir = makeTempDir("avi-plugin-worker-live-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-live-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir);

  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  ensureStateDir();
  // process.pid está vivo durante toda la ejecución del test.
  writeFileSync(workerPidPath(), String(process.pid), "utf8");
  enqueuePayload(
    {
      session_id: "s-live",
      hook_event_name: "Stop",
      last_assistant_message: "no debe narrarse por segundo worker",
    },
    "default",
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);
  assert.equal(
    readFileSync(workerPidPath(), "utf8").trim(),
    String(process.pid),
  );
  assert.equal(listPending().length, 1);
  assert.equal(existsSync(join(cliDir, "argv.log")), false);
});

/** Líneas de worker.log que contienen `marker`, en orden. */
function logLines(marker: string): string[] {
  return readFileSync(workerLogPath(), "utf8")
    .split("\n")
    .filter((line) => line.includes(marker));
}

test("worker registra la pista de cada reason de speech play y degrada el desconocido al código", () => {
  const dir = makeTempDir("avi-plugin-worker-play-reason-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-play-reason-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir, [
    { stdout: '{"error":"e","reason":"speech_not_found"}', exit: 3 },
    { stdout: '{"error":"e","reason":"voice_not_found"}', exit: 3 },
    { stdout: '{"error":"e","reason":"no_output_device"}', exit: 3 },
    { stdout: '{"error":"e","reason":"audio_backend_unavailable"}', exit: 3 },
    { stdout: '{"error":"e","reason":"playback_failed"}', exit: 1 },
    { stdout: '{"error":"e","reason":"reason_del_futuro"}', exit: 3 },
    { stdout: "no es json", exit: 3 },
    { stdout: '{"error":"e","reason":"invalid_identifier"}', exit: 2 },
  ]);

  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  for (let i = 1; i <= 8; i++) {
    enqueuePayload(
      {
        session_id: `p${i}`,
        hook_event_name: "UserPromptSubmit",
        prompt: "x",
      },
      "default",
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);

  const lines = logLines("speech play salió con código");
  assert.equal(lines.length, 8);
  assert.match(
    lines[0]!,
    /código 3 \(speech_not_found: .*voz default; ejecuta narrate-ctl presynth --voice default\)$/,
  );
  assert.match(
    lines[1]!,
    /código 3 \(voice_not_found: la voz default no existe .*\/config.*\)$/,
  );
  assert.ok(!lines[1]!.includes("setup"));
  assert.match(lines[2]!, /código 3 \(no_output_device: .*devices\)$/);
  assert.match(lines[3]!, /código 3 \(audio_backend_unavailable: .*\)$/);
  assert.match(lines[4]!, /código 1 \(playback_failed: .*\)$/);
  assert.match(lines[5]!, /speech play salió con código 3$/);
  assert.match(lines[6]!, /speech play salió con código 3$/);
  assert.match(
    lines[7]!,
    /código 2 \(invalid_identifier: el nombre de voz «default» no es válido; .*\/config.*\)$/,
  );
});

test("worker registra la pista de cada reason de speech say", () => {
  const dir = makeTempDir("avi-plugin-worker-say-reason-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("avi-plugin-cli-say-reason-");
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir, [
    { stdout: '{"error":"e","reason":"daemon_unreachable"}', exit: 5 },
    { stdout: '{"error":"e","reason":"no_output_device"}', exit: 3 },
    { stdout: '{"error":"e","reason":"model_missing"}', exit: 4 },
  ]);

  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });

  for (const [i, text] of ["uno", "dos", "tres"].entries()) {
    enqueuePayload(
      {
        session_id: `s${i + 1}`,
        hook_event_name: "Stop",
        last_assistant_message: text,
      },
      "default",
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  };

  const res = runWorker(env);
  assert.equal(res.status, 0);

  const lines = logLines("speech say salió con código");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /código 5 \(daemon_unreachable: .*daemon start\)$/);
  assert.match(lines[1]!, /código 3 \(no_output_device: .*\)$/);
  assert.match(lines[2]!, /código 4 \(model_missing: .*setup\)$/);
});

// --- Rotación de worker.log ---

const LOG_MAX_BYTES = 512 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prepara worker.log y worker.log.1 en un state dir aislado y ejecuta el
 * worker con un `speech say` que falla, para provocar exactamente una
 * escritura en worker.log.
 */
function runWorkerWithOneLogLine(setup: () => void, label: string): void {
  const dir = makeTempDir(`avi-plugin-worker-rotate-${label}-`);
  restoreDirs.push(dir);
  const cliDir = makeTempDir(`avi-plugin-cli-rotate-${label}-`);
  restoreDirs.push(cliDir);
  makeFakeCli(cliDir, [
    { stdout: '{"error":"e","reason":"daemon_unreachable"}', exit: 5 },
  ]);
  restoreEnv = withEnv({
    LOCALAPPDATA: dir,
    HOME: dir,
    XDG_STATE_HOME: dir,
    GEMINI_API_KEY: undefined,
  });
  ensureStateDir();
  setup();
  enqueuePayload(
    {
      session_id: "r1",
      hook_event_name: "Stop",
      last_assistant_message: "rotar",
    },
    "default",
  );
  const res = runWorker({
    ...process.env,
    PATH: cliDir + delimiter + process.env.PATH,
  });
  assert.equal(res.status, 0);
}

test("worker.log por encima de 512 KiB se rota a worker.log.1, que reemplaza al anterior", () => {
  const big = "x".repeat(LOG_MAX_BYTES + 1);
  runWorkerWithOneLogLine(() => {
    writeFileSync(workerLogPath(), big);
    writeFileSync(rotatedWorkerLogPath(), "generación anterior\n");
  }, "size");
  assert.equal(readFileSync(rotatedWorkerLogPath(), "utf8"), big);
  assert.equal(logLines("speech say salió con código").length, 1);
  assert.ok(statSync(workerLogPath()).size < 1024);
});

test("worker.log por debajo del umbral no se rota", () => {
  const small = "línea previa\n";
  runWorkerWithOneLogLine(() => {
    writeFileSync(workerLogPath(), small);
  }, "below");
  assert.equal(existsSync(rotatedWorkerLogPath()), false);
  const content = readFileSync(workerLogPath(), "utf8");
  assert.ok(content.startsWith(small));
  assert.equal(logLines("speech say salió con código").length, 1);
});

test("worker.log.1 sin modificar hace más de 14 días se borra", () => {
  runWorkerWithOneLogLine(() => {
    writeFileSync(rotatedWorkerLogPath(), "vieja\n");
    const old = new Date(Date.now() - 15 * DAY_MS);
    utimesSync(rotatedWorkerLogPath(), old, old);
  }, "expired");
  assert.equal(existsSync(rotatedWorkerLogPath()), false);
  assert.equal(logLines("speech say salió con código").length, 1);
});

test("worker.log.1 reciente se conserva", () => {
  runWorkerWithOneLogLine(() => {
    writeFileSync(rotatedWorkerLogPath(), "reciente\n");
    const recent = new Date(Date.now() - 13 * DAY_MS);
    utimesSync(rotatedWorkerLogPath(), recent, recent);
  }, "recent");
  assert.equal(readFileSync(rotatedWorkerLogPath(), "utf8"), "reciente\n");
});
