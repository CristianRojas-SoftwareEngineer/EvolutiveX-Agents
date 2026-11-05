// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Despachador desanclado: lanza la entrada hermana notification-deliver.js con
// la solicitud serializada, sin esperar, y deja constancia de un despacho
// fallido en notification.log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { DetachedNotificationDispatcher } from "../src/notifications/dispatcher.js";
import {
  appendNotificationLog,
  parseDeliveryRequest,
} from "../src/notifications/delivery.js";
import { notificationLogPath } from "../src/lib/state-dir.js";
import { existsSync, readFileSync } from "node:fs";
import { isolateStateDir, removeDir } from "./helpers.js";

const PAYLOAD = {
  title: "Stop",
  message: "Respuesta lista",
  silent: true,
  appId: "EvolutiveX.Agents",
};

test("notify lanza node con la ruta hermana notification-deliver.js y el JSON", () => {
  const spawned: Array<{ cmd: string; args: string[] }> = [];
  const logs: string[] = [];
  const dispatcher = new DetachedNotificationDispatcher("Stop", {
    spawn: (cmd, args) => {
      spawned.push({ cmd, args });
      return 1234;
    },
    log: (message) => logs.push(message),
  });
  dispatcher.notify(PAYLOAD);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]?.cmd, process.execPath);
  assert.equal(spawned[0]?.args.length, 2);
  assert.equal(basename(spawned[0]?.args[0] ?? ""), "notification-deliver.js");
  assert.deepEqual(parseDeliveryRequest(spawned[0]?.args[1]), {
    event: "Stop",
    payload: PAYLOAD,
  });
  assert.deepEqual(logs, []);
});

test("notify no espera a la entrega: devuelve de inmediato", () => {
  const dispatcher = new DetachedNotificationDispatcher("Stop", {
    spawn: () => 1,
    log: () => {},
  });
  assert.equal(dispatcher.notify(PAYLOAD), undefined);
});

test("un spawn sin PID registra dispatch_failed con el evento", () => {
  const logs: string[] = [];
  new DetachedNotificationDispatcher("SessionEnd", {
    spawn: () => undefined,
    log: (message) => logs.push(message),
  }).notify(PAYLOAD);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /event=SessionEnd/);
  assert.match(logs[0] ?? "", /dispatch_failed/);
});

test("un spawn que lanza también registra dispatch_failed y no propaga el error", () => {
  const logs: string[] = [];
  const dispatcher = new DetachedNotificationDispatcher("Stop", {
    spawn: () => {
      throw new Error("EAGAIN");
    },
    log: (message) => logs.push(message),
  });
  assert.doesNotThrow(() => dispatcher.notify(PAYLOAD));
  assert.match(logs[0] ?? "", /dispatch_failed.*EAGAIN/);
});

test("appendNotificationLog crea el directorio de estado si aún no existe", () => {
  const state = isolateStateDir();
  try {
    removeDir(state.dir);
    assert.equal(existsSync(state.dir), false);
    appendNotificationLog("event=Stop result=dispatch_failed");
    assert.match(
      readFileSync(notificationLogPath(), "utf8"),
      /event=Stop result=dispatch_failed\n$/,
    );
  } finally {
    state.restore();
  }
});

test("el motivo de dispatch_failed se registra en una sola línea", () => {
  const logs: string[] = [];
  new DetachedNotificationDispatcher("Stop", {
    spawn: () => {
      throw new Error('falló\ncon "comillas"\r\ny saltos');
    },
    log: (message) => logs.push(message),
  }).notify(PAYLOAD);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0] ?? "", /[\r\n]/);
});
