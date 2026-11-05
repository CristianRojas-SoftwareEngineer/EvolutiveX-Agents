// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Núcleo de entrega: la solicitud sobrevive sin pérdida a la serialización
// (incluido un viaje real entre procesos por argv), cada entrega deja una
// línea en el log, y el registro AUMID se reconcilia solo en Windows con
// SessionStart y antes de entregar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  deliver,
  parseDeliveryRequest,
  serializeDeliveryRequest,
} from "../src/notifications/delivery.js";
import type {
  DeliveryDeps,
  DeliveryRequest,
} from "../src/notifications/delivery.js";

const TRICKY_VALUES = [
  "línea 1\nlínea 2\r\nlínea 3",
  "comillas \"dobles\" y 'simples' y `backticks`",
  "termina en barra \\",
  "C:\\ruta\\con\\barra\\final\\",
  "& | > < ^ %",
  "%PATH% $HOME $(whoami) `id`",
  "emoji 😀🎉 y «comillas angulares»",
  "",
  "--flag-falso",
  "--",
  "-x",
];

function requestsWith(value: string): DeliveryRequest[] {
  return [
    {
      event: "Stop",
      payload: {
        title: value,
        message: value,
        sound: false,
        silent: true,
        appId: "EvolutiveX.Agents",
        icon: value,
      },
    },
    { event: value || "Stop", payload: { title: "t", message: value } },
  ];
}

test("ida y vuelta: la solicitud serializada y validada es idéntica a la original", () => {
  for (const value of TRICKY_VALUES) {
    for (const request of requestsWith(value)) {
      assert.deepEqual(
        parseDeliveryRequest(serializeDeliveryRequest(request)),
        request,
        `falló con ${JSON.stringify(value)}`,
      );
    }
  }
});

test("ida y vuelta entre procesos: argv conserva el JSON byte a byte", () => {
  for (const value of TRICKY_VALUES) {
    for (const request of requestsWith(value)) {
      const json = serializeDeliveryRequest(request);
      const res = spawnSync(
        process.execPath,
        ["-e", "process.stdout.write(process.argv[1])", json],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(res.status, 0);
      assert.equal(res.stdout, json, `falló con ${JSON.stringify(value)}`);
      assert.deepEqual(parseDeliveryRequest(res.stdout), request);
    }
  }
});

test("parseDeliveryRequest rechaza lo que no es una solicitud válida", () => {
  const invalid: unknown[] = [
    undefined,
    "",
    "no es json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ event: "", payload: { title: "t", message: "m" } }),
    JSON.stringify({ event: "Stop" }),
    JSON.stringify({ event: "Stop", payload: { title: "t" } }),
    JSON.stringify({ event: "Stop", payload: { title: 1, message: "m" } }),
    JSON.stringify({
      event: "Stop",
      payload: { title: "t", message: "m", sound: 3 },
    }),
    JSON.stringify({
      event: "Stop",
      payload: { title: "t", message: "m", silent: "si" },
    }),
    JSON.stringify({
      event: "Stop",
      payload: { title: "t", message: "m", icon: 5 },
    }),
  ];
  for (const value of invalid) {
    assert.equal(parseDeliveryRequest(value), undefined, String(value));
  }
});

interface Harness {
  deps: DeliveryDeps;
  calls: string[];
  logs: string[];
}

function harness(
  options: {
    platform?: NodeJS.Platform;
    notifyFails?: boolean;
    ensure?: DeliveryDeps["ensureRegistered"];
  } = {},
): Harness {
  const calls: string[] = [];
  const logs: string[] = [];
  let clock = 1000;
  return {
    calls,
    logs,
    deps: {
      notifier: {
        notify: () => {
          calls.push("notify");
          if (options.notifyFails) throw new Error("backend caído\ncon salto");
        },
      },
      ensureRegistered:
        options.ensure ??
        (async () => {
          calls.push("ensureRegistered");
          return { ok: true, changed: false };
        }),
      now: () => (clock += 25),
      platform: options.platform ?? "linux",
      log: (message) => logs.push(message),
    },
  };
}

const STOP: DeliveryRequest = {
  event: "Stop",
  payload: { title: "Stop", message: "listo" },
};
const SESSION_START: DeliveryRequest = {
  event: "SessionStart",
  payload: { title: "SessionStart", message: "hola" },
};

test("deliver deja una línea por entrega exitosa con evento, resultado y duración", async () => {
  const h = harness();
  const result = await deliver(STOP, h.deps);
  assert.equal(result.ok, true);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0] ?? "", /^event=Stop result=ok durationMs=\d+$/);
});

test("deliver deja una línea con el error si la entrega falla, y nunca lanza", async () => {
  const h = harness({ notifyFails: true });
  const result = await deliver(STOP, h.deps);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /backend caído/);
  assert.equal(h.logs.length, 1);
  const line = h.logs[0] ?? "";
  assert.match(line, /^event=Stop result=error durationMs=\d+ error="/);
  assert.doesNotMatch(line, /\n/);
  assert.match(line, /backend caído con salto/);
});

test("deliver no lanza aunque el log falle", async () => {
  const h = harness({ notifyFails: true });
  h.deps.log = () => {
    throw new Error("disco lleno");
  };
  const result = await deliver(STOP, h.deps);
  assert.equal(result.ok, false);
});

test("ensureRegistered se invoca solo con win32 y SessionStart, y antes de entregar", async () => {
  const win = harness({ platform: "win32" });
  await deliver(SESSION_START, win.deps);
  assert.deepEqual(win.calls, ["ensureRegistered", "notify"]);

  const winStop = harness({ platform: "win32" });
  await deliver(STOP, winStop.deps);
  assert.deepEqual(winStop.calls, ["notify"]);

  for (const platform of ["linux", "darwin"] as const) {
    const other = harness({ platform });
    await deliver(SESSION_START, other.deps);
    assert.deepEqual(other.calls, ["notify"], platform);
  }
});

test("un fallo del registro AUMID se registra pero no impide entregar", async () => {
  const failing = harness({
    platform: "win32",
    ensure: async () => ({ ok: false, step: "registry", error: "sin acceso" }),
  });
  assert.equal((await deliver(SESSION_START, failing.deps)).ok, true);
  assert.equal(failing.logs.length, 2);
  assert.match(failing.logs[0] ?? "", /aumid_reconcile_failed step=registry/);

  const throwing = harness({
    platform: "win32",
    ensure: async () => {
      throw new Error("explotó");
    },
  });
  assert.equal((await deliver(SESSION_START, throwing.deps)).ok, true);
  assert.match(throwing.logs[0] ?? "", /aumid_reconcile_failed/);

  const changed = harness({
    platform: "win32",
    ensure: async () => ({ ok: true, changed: true }),
  });
  await deliver(SESSION_START, changed.deps);
  assert.equal(changed.logs[0], "aumid_reconciled");
});
