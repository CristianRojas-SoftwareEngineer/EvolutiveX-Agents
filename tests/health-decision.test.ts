// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Decisión pura del health-check contra el contrato v0.36.2 de `doctor --json`
// (DOCTOR.md del tag): emite exactamente un objeto con `failed: string[]` y
// `checks: {name, ok, detail}[]`; el veredicto sale del exit más el reporte
// válido, nunca de un campo `status` que el motor no emite. La entrada de la
// decisión es {exitCode, report} y devuelve healthy | notify | uncertain.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideHealthAction,
  parseSingleJsonObject,
  NOT_PROVISIONED_MESSAGE,
} from "../src/lib/health-decision.js";

/** Reporte mínimo del contrato v0.36.2 (shape congelado desde DOCTOR.md). */
function healthyReport() {
  return {
    schema_version: "5",
    version: "0.36.2",
    failed: [],
    checks: [
      { name: "install_receipt", ok: true, detail: "recibo válido" },
      { name: "models_provisioned", ok: true, detail: "cinco modelos" },
    ],
    models: { missing: [] },
  };
}

/** Reporte con los checks indicados fallando (exit 1 del motor). */
function failingReport(failed: string[], missing: string[] = []) {
  return {
    schema_version: "5",
    failed,
    checks: failed.map((name) => ({
      name,
      ok: false,
      detail: `falla ${name}`,
    })),
    models: { missing },
  };
}

test("exit 0 + reporte válido + failed vacío ⇒ healthy", () => {
  assert.deepEqual(
    decideHealthAction({ exitCode: 0, report: healthyReport() }),
    { kind: "healthy" },
  );
});

test("exit 1 + models_provisioned fallido ⇒ notify con setup y los modelos missing", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport(
      ["models_provisioned"],
      ["qwen3-tts-0.6b-base", "qwen3-tts-0.6b"],
    ),
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  assert.ok(message.includes(NOT_PROVISIONED_MESSAGE));
  assert.match(message, /ai-voice-interconnector setup/);
  assert.match(message, /qwen3-tts-0\.6b-base/);
  assert.match(message, /qwen3-tts-0\.6b/);
});

test("exit 1 + varios checks fallidos ⇒ un solo aviso que no oculta ninguno", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport([
      "install_receipt",
      "pending_artifacts",
      "path_resolves",
    ]),
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  for (const name of [
    "install_receipt",
    "pending_artifacts",
    "path_resolves",
  ]) {
    assert.ok(message.includes(name), `el aviso debe nombrar ${name}`);
  }
  assert.match(message, /doctor --json/);
});

test("exit 1 + check desconocido ⇒ aviso que lo nombra, sin remedio inventado", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport(["check_del_futuro"]),
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  assert.ok(message.includes("check_del_futuro"));
  assert.ok(!message.includes("cleanup"));
});

test("exit 1 + objeto de error doctor_failed ⇒ aviso de fallo del diagnóstico, distinto del veredicto negativo", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: {
      schema_version: "5",
      error: "no se pudo resolver el ejecutable en ejecución",
      reason: "doctor_failed",
      message: "doctor falló",
    },
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  assert.ok(
    !message.includes("setup"),
    "el fallo del comando no es un problema de provisión",
  );
  assert.match(message, /doctor/i);
});

const uncertainCases: Array<
  [string, { exitCode: number | null; report: unknown }]
> = [
  [
    "exit 0 con failed no vacío (incoherente)",
    { exitCode: 0, report: failingReport(["models_provisioned"]) },
  ],
  [
    "exit 1 con failed vacío (incoherente)",
    { exitCode: 1, report: healthyReport() },
  ],
  [
    "exit 0 con objeto de error",
    { exitCode: 0, report: { reason: "doctor_failed", error: "x" } },
  ],
  ["exit 1 sin reporte", { exitCode: 1, report: undefined }],
  [
    "timeout (exit null) con reporte sano",
    { exitCode: null, report: healthyReport() },
  ],
  ["failed no es array", { exitCode: 0, report: { failed: "no", checks: [] } }],
  ["checks ausente", { exitCode: 0, report: { failed: [] } }],
  [
    "reason desconocido en objeto de error",
    { exitCode: 1, report: { reason: "motivo_del_futuro", error: "x" } },
  ],
];

for (const [name, input] of uncertainCases) {
  test(`incierto: ${name}`, () => {
    assert.deepEqual(decideHealthAction(input), { kind: "uncertain" });
  });
}

test("parseSingleJsonObject: objeto único válido ⇒ lo devuelve", () => {
  const report = healthyReport();
  assert.deepEqual(parseSingleJsonObject(JSON.stringify(report)), report);
});

test("parseSingleJsonObject: objeto único con espacios finales ⇒ lo devuelve", () => {
  const report = healthyReport();
  assert.deepEqual(
    parseSingleJsonObject(JSON.stringify(report) + "  \n"),
    report,
  );
});

test("parseSingleJsonObject: dos objetos concatenados ⇒ undefined (salida inválida)", () => {
  const text =
    JSON.stringify(healthyReport()) +
    "\n" +
    JSON.stringify({ error: "x", reason: "doctor_failed" });
  assert.equal(parseSingleJsonObject(text), undefined);
});

test("parseSingleJsonObject: contenido tras el cierre del objeto ⇒ undefined", () => {
  assert.equal(
    parseSingleJsonObject(JSON.stringify(healthyReport()) + " basura"),
    undefined,
  );
});

test("parseSingleJsonObject: texto sin objeto ⇒ undefined", () => {
  assert.equal(parseSingleJsonObject("sin json aquí"), undefined);
});

test("parseSingleJsonObject: fragmento malformado ⇒ undefined", () => {
  assert.equal(parseSingleJsonObject('{"failed": '), undefined);
});
