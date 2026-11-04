// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Registro del último problema de voz: se avisa una vez por par {voice,
// reason} notificable, las razones no notificables no tocan el registro, un
// éxito lo borra y rearma el aviso, y un registro ilegible cuenta como
// ausente. State dir aislado.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureStateDir, voiceProblemPath } from "../src/lib/state-dir.js";
import { trackVoiceProblem } from "../src/voice/voice-problem.js";
import { isolateStateDir } from "./helpers.js";

let restore: () => void;

beforeEach(() => {
  restore = isolateStateDir().restore;
});

afterEach(() => {
  restore();
});

const notFound = { ok: false, reason: "voice_not_found" } as const;

function recorded(): unknown {
  return JSON.parse(readFileSync(voiceProblemPath(), "utf8"));
}

test("el primer fallo notificable avisa y queda registrado", () => {
  assert.equal(trackVoiceProblem("custom", notFound), true);
  assert.deepEqual(recorded(), { voice: "custom", reason: "voice_not_found" });
});

test("el mismo problema repetido no vuelve a avisar", () => {
  trackVoiceProblem("custom", notFound);
  assert.equal(trackVoiceProblem("custom", notFound), false);
});

test("otra razón notificable o la misma con otra voz vuelve a avisar", () => {
  trackVoiceProblem("custom", notFound);
  assert.equal(
    trackVoiceProblem("custom", { ok: false, reason: "speech_not_found" }),
    true,
  );
  assert.equal(
    trackVoiceProblem("custom", { ok: false, reason: "invalid_voice_name" }),
    true,
  );
  trackVoiceProblem("custom", notFound);
  assert.equal(trackVoiceProblem("ryan", notFound), true);
  assert.deepEqual(recorded(), { voice: "ryan", reason: "voice_not_found" });
});

test("una razón no notificable o un fallo sin razón no avisan ni tocan el registro", () => {
  trackVoiceProblem("custom", notFound);
  assert.equal(
    trackVoiceProblem("custom", { ok: false, reason: "daemon_unreachable" }),
    false,
  );
  assert.equal(trackVoiceProblem("custom", { ok: false }), false);
  assert.deepEqual(recorded(), { voice: "custom", reason: "voice_not_found" });
});

test("sin registro, una razón no notificable no crea el archivo", () => {
  trackVoiceProblem("default", { ok: false, reason: "daemon_unreachable" });
  assert.equal(existsSync(voiceProblemPath()), false);
});

test("un éxito borra el registro y el fallo siguiente vuelve a avisar", () => {
  trackVoiceProblem("custom", notFound);
  assert.equal(trackVoiceProblem("custom", { ok: true }), false);
  assert.equal(existsSync(voiceProblemPath()), false);
  assert.equal(trackVoiceProblem("custom", notFound), true);
});

test("un registro ilegible se trata como ausente", () => {
  ensureStateDir();
  writeFileSync(voiceProblemPath(), "{no es json");
  assert.equal(trackVoiceProblem("custom", notFound), true);
  assert.deepEqual(recorded(), { voice: "custom", reason: "voice_not_found" });
});
