// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Cola FIFO de payloads: enqueue ordenado con la voz de cada ítem, claimNext
// lee y borra (y descarta los ítems sin la forma `{payload, voice}`),
// pruneQueue acota por tope y TTL. Usa state dir aislado en temporal.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { queueDir } from "../src/lib/state-dir.js";
import {
  enqueuePayload,
  listPending,
  claimNext,
  pruneQueue,
  clearQueue,
} from "../src/voice/queue.js";
import { isolateStateDir } from "./helpers.js";

let restore: () => void;

beforeEach(() => {
  const isolated = isolateStateDir();
  restore = isolated.restore;
});

afterEach(() => {
  restore();
});

test("enqueue escribe dos payloads y los lista en orden de llegada", () => {
  const f1 = enqueuePayload(
    {
      session_id: "s1",
      hook_event_name: "UserPromptSubmit",
    },
    "default",
  );
  const f2 = enqueuePayload(
    { session_id: "s2", hook_event_name: "Stop" },
    "default",
  );
  const pending = listPending();
  assert.deepEqual(
    pending,
    [basename(f1), basename(f2)],
    "deben conservar exactamente el orden de inserción (f1 antes que f2)",
  );
});

test("claimNext lee el primer payload y lo borra de la cola", () => {
  enqueuePayload(
    { session_id: "s1", hook_event_name: "UserPromptSubmit" },
    "default",
  );
  const first = claimNext();
  assert.ok(first);
  assert.equal(first!.payload.session_id, "s1");
  assert.equal(
    listPending().length,
    0,
    "la cola debe quedar vacía tras reclamar",
  );
});

test("claimNext devuelve la voz anotada en cada ítem", () => {
  enqueuePayload({ session_id: "s1", hook_event_name: "Stop" }, "mi_voz");
  enqueuePayload({ session_id: "s2", hook_event_name: "Stop" }, "default");
  assert.equal(claimNext()!.voice, "mi_voz");
  assert.equal(claimNext()!.voice, "default");
});

test("claimNext descarta los ítems sin la forma {payload, voice} y sigue con el siguiente", () => {
  mkdirSync(queueDir(), { recursive: true });
  const invalid = [
    JSON.stringify({ session_id: "viejo", hook_event_name: "Stop" }),
    JSON.stringify({ payload: { hook_event_name: "Stop" } }),
    JSON.stringify({ payload: "x", voice: "default" }),
    JSON.stringify({ payload: {}, voice: "" }),
    "no es json",
  ];
  invalid.forEach((raw, i) =>
    writeFileSync(
      join(queueDir(), `000000000000${i}-000000-0000000001-invalido.json`),
      raw,
    ),
  );
  enqueuePayload({ session_id: "nuevo", hook_event_name: "Stop" }, "mi_voz");
  const item = claimNext();
  assert.ok(item);
  assert.equal(item!.payload.session_id, "nuevo");
  assert.equal(item!.voice, "mi_voz");
  assert.equal(listPending().length, 0);
});

test("claimNext con solo ítems inválidos los borra y devuelve undefined", () => {
  mkdirSync(queueDir(), { recursive: true });
  writeFileSync(
    join(queueDir(), "0000000000001-000000-0000000001-invalido.json"),
    JSON.stringify({ hook_event_name: "Stop" }),
  );
  assert.equal(claimNext(), undefined);
  assert.equal(listPending().length, 0);
});

test("claimNext en cola vacía devuelve undefined", () => {
  assert.equal(claimNext(), undefined);
});

test("pruneQueue descarta el más viejo al superar el tope", () => {
  const f1 = enqueuePayload(
    {
      session_id: "s1",
      hook_event_name: "UserPromptSubmit",
    },
    "default",
  );
  const f2 = enqueuePayload(
    { session_id: "s2", hook_event_name: "Stop" },
    "default",
  );
  const f3 = enqueuePayload(
    {
      session_id: "s3",
      hook_event_name: "Notification",
    },
    "default",
  );
  pruneQueue({ max: 2, maxAgeMs: 60 * 60 * 1000 });
  const pending = listPending();
  assert.ok(!pending.includes(basename(f1)), "el más viejo (s1) se descarta");
  assert.deepEqual(pending, [basename(f2), basename(f3)]);
});

test("enqueue y pruneQueue preservan el orden FIFO estricto en ráfagas dentro del mismo milisegundo", () => {
  const inserted: string[] = [];
  for (let i = 0; i < 20; i++) {
    const file = enqueuePayload(
      {
        session_id: `s-${i}`,
        hook_event_name: "Stop",
      },
      "default",
    );
    inserted.push(basename(file));
  }
  assert.deepEqual(listPending(), inserted);
  pruneQueue({ max: 5, maxAgeMs: 60 * 60 * 1000 });
  assert.deepEqual(listPending(), inserted.slice(-5));
});

test("pruneQueue elimina archivos expirados por TTL", () => {
  enqueuePayload(
    { session_id: "s1", hook_event_name: "UserPromptSubmit" },
    "default",
  );
  pruneQueue({ max: 64, maxAgeMs: -1000 }); // TTL negativa: todo expira
  assert.equal(listPending().length, 0, "todo se elimina con TTL negativa");
});

test("clearQueue elimina todos los archivos de la cola", () => {
  enqueuePayload(
    { session_id: "s1", hook_event_name: "UserPromptSubmit" },
    "default",
  );
  enqueuePayload({ session_id: "s2", hook_event_name: "Stop" }, "default");
  clearQueue();
  assert.equal(listPending().length, 0);
});
