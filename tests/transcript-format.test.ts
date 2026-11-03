// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Formato del transcript enriquecido: hora de reloj en 12 h con a.m. / p.m.,
// duraciones cerradas (un decimal bajo 10 s, luego segundos, minutos y horas)
// y contadores en vivo (segundos enteros con `…`). Las horas se construyen con
// fechas locales para que el resultado no dependa de la zona horaria.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClockTime,
  formatDuration,
  formatRunning,
} from "../src/transcript/format.js";

const at = (h: number, m: number, s: number) =>
  new Date(2026, 0, 15, h, m, s).getTime();

test("formatClockTime convierte a 12 h con a.m. / p.m.", () => {
  assert.equal(formatClockTime(at(0, 5, 9)), "12:05:09 a.m.");
  assert.equal(formatClockTime(at(11, 59, 59)), "11:59:59 a.m.");
  assert.equal(formatClockTime(at(12, 0, 0)), "12:00:00 p.m.");
  assert.equal(formatClockTime(at(13, 7, 3)), "1:07:03 p.m.");
  assert.equal(formatClockTime(at(23, 30, 0)), "11:30:00 p.m.");
});

test("formatDuration cubre cada rango en sus límites", () => {
  assert.equal(formatDuration(0), "<0.1s");
  assert.equal(formatDuration(99), "<0.1s");
  assert.equal(formatDuration(100), "0.1s");
  assert.equal(formatDuration(9949), "9.9s");
  assert.equal(formatDuration(9950), "10s");
  assert.equal(formatDuration(59_499), "59s");
  assert.equal(formatDuration(59_500), "1m 00s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(3_600_000), "1h 00m 00s");
  assert.equal(formatDuration(3_725_000), "1h 02m 05s");
});

test("formatRunning cuenta segundos enteros y añade `…`", () => {
  assert.equal(formatRunning(0), "0s…");
  assert.equal(formatRunning(9999), "9s…");
  assert.equal(formatRunning(10_000), "10s…");
  assert.equal(formatRunning(65_400), "1m 05s…");
  assert.equal(formatRunning(3_725_900), "1h 02m 05s…");
});
