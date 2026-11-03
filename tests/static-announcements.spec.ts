// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// El catálogo de anuncios pre-sintetizados es contrato doble: el worker
// reproduce por label y `presynth` sintetiza por label, ambos desde este mismo
// catálogo. Cada label es un slug semántico fijo asignado por anuncio (no
// derivado del texto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANNOUNCEMENTS } from "../src/voice/message/static-announcements.js";

test("el catálogo fija el texto literal de los seis anuncios", () => {
  assert.equal(ANNOUNCEMENTS.UserPromptSubmit.text, "Procesando con Claude.");
  assert.equal(ANNOUNCEMENTS.Stop.text, "El asistente terminó su turno.");
  assert.equal(
    ANNOUNCEMENTS.SubagentStop.text,
    "El subagente completó su trabajo.",
  );
  assert.equal(
    ANNOUNCEMENTS.StopFailure.text,
    "Ocurrió un error durante la ejecución.",
  );
  assert.equal(ANNOUNCEMENTS.Notification.text, "Claude necesita tu atención.");
  assert.equal(ANNOUNCEMENTS.Default.text, "Notificación de Claude.");
  assert.equal(Object.keys(ANNOUNCEMENTS).length, 6);
});

test("el texto de cada anuncio termina en punto (oración cerrada)", () => {
  for (const { text } of Object.values(ANNOUNCEMENTS)) {
    assert.ok(text.endsWith("."), `«${text}» debería terminar en punto`);
  }
});

test("cada label cumple el contrato del motor: [a-z0-9._-]+", () => {
  for (const { label } of Object.values(ANNOUNCEMENTS)) {
    assert.match(label, /^[a-z0-9._-]+$/);
  }
});

test("cada anuncio tiene su slug semántico fijo y los seis son únicos", () => {
  assert.equal(
    ANNOUNCEMENTS.UserPromptSubmit.label,
    "voice-user-prompt-submit",
  );
  assert.equal(ANNOUNCEMENTS.Stop.label, "voice-stop");
  assert.equal(ANNOUNCEMENTS.SubagentStop.label, "voice-subagent-stop");
  assert.equal(ANNOUNCEMENTS.StopFailure.label, "voice-stop-failure");
  assert.equal(ANNOUNCEMENTS.Notification.label, "voice-notification");
  assert.equal(ANNOUNCEMENTS.Default.label, "voice-default");

  const labels = new Set(Object.values(ANNOUNCEMENTS).map((a) => a.label));
  assert.equal(labels.size, 6);
});
