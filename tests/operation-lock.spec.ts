// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Bloqueo de operaciones manuales de voz: toma y libera el directorio, bloquea
// con un dueño vivo o un `owner` ilegible sin ejecutar la operación, retira el
// de un dueño muerto, libera ante una excepción y admite la reentrada desde el
// mismo proceso. State dir aislado.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { voiceOperationLockPath } from "../src/lib/state-dir.js";
import {
  LOCK_BUSY_EXIT,
  withVoiceOperationLock,
} from "../src/voice/operation-lock.js";
import { isolateStateDir } from "./helpers.js";

let restore: () => void;
let restoreConsole: () => void;

beforeEach(() => {
  restore = isolateStateDir().restore;
  // Silencia el aviso de bloqueo ocupado en la salida de los tests.
  const original = console.error;
  console.error = () => {};
  restoreConsole = () => {
    console.error = original;
  };
});

afterEach(() => {
  restoreConsole();
  restore();
});

/** Deja un bloqueo con el `owner` indicado (undefined: sin archivo). */
function seedLock(owner: string | undefined): void {
  mkdirSync(voiceOperationLockPath(), { recursive: true });
  if (owner !== undefined)
    writeFileSync(join(voiceOperationLockPath(), "owner"), owner);
}

test("toma el bloqueo con el PID propio, ejecuta y lo libera", () => {
  const code = withVoiceOperationLock(() => {
    const owner = readFileSync(join(voiceOperationLockPath(), "owner"), "utf8");
    assert.equal(owner, String(process.pid));
    return 0;
  });
  assert.equal(code, 0);
  assert.equal(existsSync(voiceOperationLockPath()), false);
});

test("con un dueño vivo devuelve 6 sin ejecutar ni tocar el bloqueo", () => {
  seedLock(String(process.ppid));
  let ran = false;
  const code = withVoiceOperationLock(() => {
    ran = true;
    return 0;
  });
  assert.equal(code, LOCK_BUSY_EXIT);
  assert.equal(code, 6);
  assert.equal(ran, false);
  assert.equal(
    readFileSync(join(voiceOperationLockPath(), "owner"), "utf8"),
    String(process.ppid),
  );
});

for (const [label, owner] of [
  ["sin owner", undefined],
  ["owner ilegible", "no-es-un-pid"],
] as const) {
  test(`con ${label} devuelve 6 sin ejecutar`, () => {
    seedLock(owner);
    let ran = false;
    const code = withVoiceOperationLock(() => {
      ran = true;
      return 0;
    });
    assert.equal(code, 6);
    assert.equal(ran, false);
    assert.equal(existsSync(voiceOperationLockPath()), true);
  });
}

test("con un dueño muerto retira el bloqueo y ejecuta", () => {
  seedLock("999999");
  const code = withVoiceOperationLock(() => {
    assert.equal(
      readFileSync(join(voiceOperationLockPath(), "owner"), "utf8"),
      String(process.pid),
    );
    return 3;
  });
  assert.equal(code, 3);
  assert.equal(existsSync(voiceOperationLockPath()), false);
});

test("libera el bloqueo ante una excepción", () => {
  assert.throws(() =>
    withVoiceOperationLock(() => {
      throw new Error("fallo");
    }),
  );
  assert.equal(existsSync(voiceOperationLockPath()), false);
});

test("admite la reentrada desde el mismo proceso y libera al salir del externo", () => {
  const code = withVoiceOperationLock(() => {
    const inner = withVoiceOperationLock(() => 0);
    assert.equal(inner, 0);
    assert.equal(existsSync(voiceOperationLockPath()), true);
    return inner;
  });
  assert.equal(code, 0);
  assert.equal(existsSync(voiceOperationLockPath()), false);
});
