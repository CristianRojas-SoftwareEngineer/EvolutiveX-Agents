// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Contrato de ejecución de hooks/hooks.json: los hooks de notificaciones son
// visuales y van `async`, salvo SessionEnd, que es síncrono con `timeout: 3`
// (Claude Code lo cancela si tarda más; por eso el hook solo despacha).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface HookEntry {
  type: string;
  command: string;
  args?: string[];
  async?: boolean;
  timeout?: number;
}
interface HooksFile {
  hooks: Record<string, Array<{ hooks: HookEntry[] }>>;
}

const hooksFile = JSON.parse(
  readFileSync(join(process.cwd(), "hooks", "hooks.json"), "utf8"),
) as HooksFile;

function notificationHooks(): Array<{ event: string; hook: HookEntry }> {
  const found: Array<{ event: string; hook: HookEntry }> = [];
  for (const [event, groups] of Object.entries(hooksFile.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        if ((hook.args ?? []).some((a) => a.endsWith("notification-hook.js")))
          found.push({ event, hook });
      }
    }
  }
  return found;
}

test("todas las entradas de notification-hook.js son async, salvo SessionEnd", () => {
  const entries = notificationHooks();
  assert.ok(entries.length > 0);
  for (const { event, hook } of entries) {
    if (event === "SessionEnd") continue;
    assert.equal(hook.async, true, `${event} debe ser async`);
  }
});

test("SessionEnd es síncrono con timeout 3", () => {
  const sessionEnd = notificationHooks().filter(
    (e) => e.event === "SessionEnd",
  );
  assert.equal(sessionEnd.length, 1);
  assert.notEqual(sessionEnd[0]?.hook.async, true);
  assert.equal(sessionEnd[0]?.hook.timeout, 3);
});

test("SessionEnd es el único hook de notificaciones síncrono", () => {
  const sync = notificationHooks().filter((e) => e.hook.async !== true);
  assert.deepEqual(
    sync.map((e) => e.event),
    ["SessionEnd"],
  );
});
