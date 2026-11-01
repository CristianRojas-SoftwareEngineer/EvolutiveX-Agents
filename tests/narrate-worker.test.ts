// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Worker drenador: verifica que narra los payloads encolados en orden, sin
// duplicados, y que sale tras la ventana de inactividad. Usa dist/narrate-worker.js
// como subprocesso real con un CLI falso y state dir aislado.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, chmodSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { enqueuePayload } from "../src/lib/queue.js";
import { withEnv, makeTempDir, removeDir } from "./helpers.js";

const WORKER = join(process.cwd(), "dist", "narrate-worker.js");

let restoreDirs: string[] = [];
let restoreEnv: () => void;

afterEach(() => {
  for (const d of restoreDirs) removeDir(d);
  restoreDirs = [];
  if (restoreEnv) restoreEnv();
});

function makeFakeCli(dir: string): string {
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
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

test("worker narra dos payloads encolados en orden y sin duplicados", () => {
  const dir = makeTempDir("narrator-worker-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("narrator-cli-");
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
  enqueuePayload({
    session_id: "s1",
    hook_event_name: "UserPromptSubmit",
    prompt: "primero",
  });
  enqueuePayload({
    session_id: "s2",
    hook_event_name: "Stop",
    last_assistant_message: "segundo",
  });

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
  assert.deepEqual(calls[1], [
    "speech",
    "say",
    "--text",
    "segundo",
    "--daemon",
  ]);
});

test("worker sale tras la ventana de inactividad y deja la cola vacía", () => {
  const dir = makeTempDir("narrator-worker-empty-");
  restoreDirs.push(dir);
  const cliDir = makeTempDir("narrator-cli-empty-");
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
