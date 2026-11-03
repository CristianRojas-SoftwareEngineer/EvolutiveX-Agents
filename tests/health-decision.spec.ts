// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Decisión pura del health-check contra el contrato vigente de `doctor --json`
// (DOCTOR.md del tag): emite exactamente un objeto con `failed: string[]` y
// `checks: {name, ok, detail}[]`; el veredicto sale del exit más el reporte
// válido, nunca de un campo `status` que el motor no emite. La entrada de la
// decisión es {exitCode, report} y devuelve healthy | notify | uncertain. Como
// `doctor` es integral, la decisión aplica un gate de recursos: solo
// `models_provisioned` y `onnx_runtime` bloquean; el resto se avisa sin bloquear.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideHealthAction,
  parseSingleJsonObject,
  NOT_PROVISIONED_MESSAGE,
} from "../src/voice/health-decision.js";
import { ENGINE_VERSION } from "./helpers.js";

/** Reporte mínimo del contrato vigente (shape congelado desde DOCTOR.md). */
function healthyReport() {
  return {
    schema_version: "6",
    version: ENGINE_VERSION,
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
    schema_version: "6",
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

test("exit 1 + onnx_runtime fallido ⇒ notify que lo nombra, sin mensaje de setup", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport(["onnx_runtime"]),
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  assert.ok(message.includes("onnx_runtime"));
  assert.match(message, /doctor --json/);
  assert.ok(!message.includes(NOT_PROVISIONED_MESSAGE));
});

test("exit 1 + recurso e informativo mezclados ⇒ notify que nombra ambos", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport(
      ["models_provisioned", "install_receipt"],
      ["dpdfnet8"],
    ),
  });
  assert.equal(decision.kind, "notify");
  const message = decision.kind === "notify" ? decision.message : "";
  assert.ok(message.includes("models_provisioned"));
  assert.ok(message.includes("install_receipt"));
  assert.ok(message.includes(NOT_PROVISIONED_MESSAGE));
  assert.ok(message.includes("dpdfnet8"));
});

test("exit 1 + solo checks informativos ⇒ healthy con aviso que no oculta ninguno", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport([
      "install_receipt",
      "pending_artifacts",
      "path_resolves",
    ]),
  });
  assert.equal(decision.kind, "healthy");
  const advisory = decision.kind === "healthy" ? (decision.advisory ?? "") : "";
  for (const name of [
    "install_receipt",
    "pending_artifacts",
    "path_resolves",
  ]) {
    assert.ok(advisory.includes(name), `el aviso debe nombrar ${name}`);
  }
  assert.match(advisory, /doctor --json/);
  assert.ok(!advisory.includes(NOT_PROVISIONED_MESSAGE));
});

test("exit 1 + check desconocido ⇒ healthy con aviso que lo nombra, sin remedio inventado", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: failingReport(["check_del_futuro"]),
  });
  assert.equal(decision.kind, "healthy");
  const advisory = decision.kind === "healthy" ? (decision.advisory ?? "") : "";
  assert.ok(advisory.includes("check_del_futuro"));
  assert.ok(!advisory.includes("cleanup"));
});

test("exit 1 + objeto de error doctor_failed ⇒ aviso de fallo del diagnóstico, distinto del veredicto negativo", () => {
  const decision = decideHealthAction({
    exitCode: 1,
    report: {
      schema_version: "6",
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
