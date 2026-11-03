// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Interpretación pura de los errores del motor (§9 de la spec de clonado):
// mensaje por `reason` conservando el exit, mensaje genérico para un `reason`
// desconocido, JSON inválido y proceso no iniciado, por señal o con timeout
// como fallos del plugin con exit 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_COMPLETED_MESSAGE,
  UNEXPECTED_RESPONSE_MESSAGE,
  engineFailure,
  engineJson,
} from "../src/voice/voice-errors.js";

function envelope(reason: string, error = "detalle del motor"): string {
  return JSON.stringify({ schema_version: "6", error, reason });
}

const CASES: Array<[string, number, RegExp]> = [
  ["invalid_voice_name", 2, /letras, números, punto, guion o guion bajo/],
  ["audio_not_found", 3, /La ruta de referencia no existe/],
  ["invalid_audio", 2, /WAV válido de hasta 30 s/],
  ["empty_audio", 2, /WAV válido de hasta 30 s/],
  ["audio_too_long", 2, /WAV válido de hasta 30 s/],
  ["no_input_device", 3, /micrófono predeterminado.*devices/],
  ["audio_backend_unavailable", 3, /backend de audio/],
  ["transcription_failed", 10, /permisos del micrófono/],
  ["voice_exists", 6, /--force/],
  ["denoise_busy", 6, /limpieza en curso/],
  ["denoise_unsupported", 1, /modelo de limpieza/],
  ["denoise_failed", 1, /modelo de limpieza/],
  ["model_missing", 4, /ai-voice-interconnector setup/],
  ["daemon_unreachable", 5, /daemon start/],
  ["voice_clone_failed", 1, /El clonado falló/],
  ["cannot_remove_default", 2, /fábrica no se pueden borrar/],
  ["voice_not_found", 3, /voice list/],
  ["lifecycle_locked", 17, /instalación o limpieza del motor/],
];

for (const [reason, exit, hint] of CASES) {
  test(`${reason} conserva el exit ${exit} y da su mensaje`, () => {
    const failure = engineFailure({ status: exit, stdout: envelope(reason) });
    assert.ok(failure);
    assert.equal(failure.exitCode, exit);
    assert.match(failure.message, hint);
    assert.match(failure.message, /^detalle del motor/);
  });
}

test("un reason desconocido conserva el exit con un mensaje genérico", () => {
  const failure = engineFailure({
    status: 7,
    stdout: envelope("reason_del_futuro", ""),
  });
  assert.deepEqual(failure, {
    exitCode: 7,
    message: "El motor falló con exit 7 (reason_del_futuro).",
  });
});

test("un envelope sin reason también da el mensaje genérico", () => {
  const failure = engineFailure({ status: 1, stdout: "{}" });
  assert.deepEqual(failure, {
    exitCode: 1,
    message: "El motor falló con exit 1.",
  });
});

test("un JSON inválido del motor es un fallo con exit 1", () => {
  for (const stdout of ["", "no es json", "[]", undefined])
    assert.deepEqual(engineFailure({ status: 3, stdout }), {
      exitCode: 1,
      message: UNEXPECTED_RESPONSE_MESSAGE,
    });
});

test("un proceso no iniciado, terminado por señal o con timeout es un fallo con exit 1", () => {
  const notCompleted = { exitCode: 1, message: NOT_COMPLETED_MESSAGE };
  assert.deepEqual(
    engineFailure({ status: null, error: new Error("ENOENT"), stdout: "" }),
    notCompleted,
  );
  assert.deepEqual(engineFailure({ status: null, stdout: "" }), notCompleted);
  assert.deepEqual(
    engineFailure({ status: 0, error: new Error("ETIMEDOUT"), stdout: "" }),
    notCompleted,
  );
});

test("exit 0 no es un fallo", () => {
  assert.equal(engineFailure({ status: 0, stdout: "{}" }), undefined);
});

test("engineJson devuelve el objeto único de stdout o undefined", () => {
  assert.deepEqual(engineJson('{"voices":[]}'), { voices: [] });
  assert.equal(engineJson("no es json"), undefined);
  assert.equal(engineJson(undefined), undefined);
});
