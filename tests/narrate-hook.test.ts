// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// El launcher real (dist/narrate-hook.js) como subproceso, con el state dir
// redirigido a un temporal vía env vars del SO anfitrión: con la voz apagada
// en /config vacía la cola pendiente y no lanza el worker.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir } from "./helpers.js";

const HOOK = join(process.cwd(), "dist", "narrate-hook.js");

let stateBase: string;

beforeEach(() => {
  stateBase = makeTempDir("avi-plugin-hook-");
});

afterEach(() => {
  removeDir(stateBase);
});

/** State dir del plugin dentro del temporal, según el SO real del host. */
function pluginStateDir(): string {
  const sub =
    process.platform === "darwin" ? join("Library", "Application Support") : "";
  return join(stateBase, sub, "evolutivex-agents");
}

/** Env que redirige el state dir al temporal según el SO real del host. */
function hookEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (process.platform === "win32") env.LOCALAPPDATA = stateBase;
  else if (process.platform === "darwin") env.HOME = stateBase;
  else env.XDG_STATE_HOME = stateBase;
  return env;
}

test("con la voz apagada vacía la cola y no lanza el worker", async () => {
  const queue = join(pluginStateDir(), "queue");
  mkdirSync(queue, { recursive: true });
  writeFileSync(
    join(queue, "0000000000001-000000-0000000001-pendient.json"),
    JSON.stringify({ hook_event_name: "Stop" }),
  );

  const res = spawnSync(process.execPath, [HOOK], {
    env: hookEnv({ CLAUDE_PLUGIN_OPTION_VOICEENABLED: "false" }),
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "x" }),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(res.status, 0);
  assert.deepEqual(readdirSync(queue), []);

  // Un worker lanzado escribiría worker.pid al arrancar: se le da margen.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(existsSync(join(pluginStateDir(), "worker.pid")), false);
});
