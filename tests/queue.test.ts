// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Cola FIFO de payloads: enqueue ordenado, claimNext lee y borra, pruneQueue
// acota por tope y TTL. Usa state dir aislado en temporal.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import {
  enqueuePayload,
  listPending,
  claimNext,
  pruneQueue,
  clearQueue,
} from "../src/lib/queue.js";
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
  const f1 = enqueuePayload({
    session_id: "s1",
    hook_event_name: "UserPromptSubmit",
  });
  const f2 = enqueuePayload({ session_id: "s2", hook_event_name: "Stop" });
  const pending = listPending();
  assert.deepEqual(
    pending,
    [basename(f1), basename(f2)],
    "deben conservar exactamente el orden de inserción (f1 antes que f2)",
  );
});

test("claimNext lee el primer payload y lo borra de la cola", () => {
  enqueuePayload({ session_id: "s1", hook_event_name: "UserPromptSubmit" });
  const first = claimNext();
  assert.ok(first);
  assert.equal(first!.payload.session_id, "s1");
  assert.equal(
    listPending().length,
    0,
    "la cola debe quedar vacía tras reclamar",
  );
});

test("claimNext en cola vacía devuelve undefined", () => {
  assert.equal(claimNext(), undefined);
});

test("pruneQueue descarta el más viejo al superar el tope", () => {
  const f1 = enqueuePayload({
    session_id: "s1",
    hook_event_name: "UserPromptSubmit",
  });
  const f2 = enqueuePayload({ session_id: "s2", hook_event_name: "Stop" });
  const f3 = enqueuePayload({
    session_id: "s3",
    hook_event_name: "Notification",
  });
  pruneQueue({ max: 2, maxAgeMs: 60 * 60 * 1000 });
  const pending = listPending();
  assert.ok(!pending.includes(basename(f1)), "el más viejo (s1) se descarta");
  assert.deepEqual(pending, [basename(f2), basename(f3)]);
});

test("enqueue y pruneQueue preservan el orden FIFO estricto en ráfagas dentro del mismo milisegundo", () => {
  const inserted: string[] = [];
  for (let i = 0; i < 20; i++) {
    const file = enqueuePayload({
      session_id: `s-${i}`,
      hook_event_name: "Stop",
    });
    inserted.push(basename(file));
  }
  assert.deepEqual(listPending(), inserted);
  pruneQueue({ max: 5, maxAgeMs: 60 * 60 * 1000 });
  assert.deepEqual(listPending(), inserted.slice(-5));
});

test("pruneQueue elimina archivos expirados por TTL", () => {
  enqueuePayload({ session_id: "s1", hook_event_name: "UserPromptSubmit" });
  pruneQueue({ max: 64, maxAgeMs: -1000 }); // TTL negativa: todo expira
  assert.equal(listPending().length, 0, "todo se elimina con TTL negativa");
});

test("clearQueue elimina todos los archivos de la cola", () => {
  enqueuePayload({ session_id: "s1", hook_event_name: "UserPromptSubmit" });
  enqueuePayload({ session_id: "s2", hook_event_name: "Stop" });
  clearQueue();
  assert.equal(listPending().length, 0);
});
