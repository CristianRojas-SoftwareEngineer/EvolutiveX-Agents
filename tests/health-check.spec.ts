// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de SessionStart (dist/health-check.js) como subproceso real, con un CLI
// `ai-voice-interconnector` falso en el PATH parametrizado por caso: `doctor
// --json` con su exit y payload (contrato vigente del motor: reporte con failed/checks o
// objeto de error), y `daemon status --json` con su exit y payload (running/
// stopped/degraded o basura). Fija por contrato el flujo nuevo: consultar el
// daemon solo tras recursos sanos, arrancarlo a lo sumo una vez y solo con
// stopped limpio, aviso por systemMessage ante negativo/degraded/incierto, y
// exit 0 en todos los caminos. Los checks informativos fallidos (instalación o
// ciclo de vida) avisan sin impedir la consulta ni el arranque del daemon.
// Con la voz activa de /config: arranque con `--warm-voice`, validación con
// `voice list --json` (voz ausente, nombre inválido o listado incierto avisan
// sin arrancar), sin reinicio del daemon corriendo y caché `active-voice`
// escrita también con la voz desactivada.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { ENGINE_VERSION, makeTempDir, removeDir, waitFor } from "./helpers.js";

const HEALTH = join(process.cwd(), "dist", "health-check.js");

let stateBase: string;

beforeEach(() => {
  stateBase = makeTempDir("avi-plugin-health-");
});

afterEach(() => {
  removeDir(stateBase);
});

/** Env que redirige el state dir al temporal según el SO real del host. */
function healthEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  Object.assign(env, extra);
  if (process.platform === "win32") env.LOCALAPPDATA = stateBase;
  else if (process.platform === "darwin") env.HOME = stateBase;
  else env.XDG_STATE_HOME = stateBase;
  return env;
}

/** Salidas del CLI falso por invocación. */
type ShimOptions = {
  doctorJson: string;
  doctorExit?: number;
  doctorDelayMs?: number;
  daemonJson?: string;
  daemonExit?: number;
  voicesJson?: string;
  voicesExit?: number;
};

/**
 * Crea un `ai-voice-interconnector` falso en `dir` (shim .cmd en Windows, script
 * sh en Unix, ambos delegando en un impl Node). Despacha por argv: `doctor
 * --json` duerme `doctorDelayMs` (default 0) y luego imprime `doctorJson` y sale
 * con `doctorExit` (default 0); `daemon status --json` imprime `daemonJson` y
 * sale con `daemonExit` (default 0); `voice list --json` imprime `voicesJson`
 * (default: las tres voces de fábrica) y sale con `voicesExit` (default 0);
 * `daemon start` se registra y sale 0. Toda invocación anota su argv en
 * `argv.log`.
 */
function makeFakeCli(dir: string, opts: ShimOptions): { argvLog: string } {
  const {
    doctorJson,
    doctorExit = 0,
    doctorDelayMs = 0,
    daemonJson,
    daemonExit = 0,
    voicesJson,
    voicesExit = 0,
  } = opts;
  const argvLog = join(dir, "argv.log");
  writeFileSync(join(dir, "doctor.json"), doctorJson);
  writeFileSync(join(dir, "doctor.exit"), String(doctorExit));
  writeFileSync(join(dir, "doctor.delay"), String(doctorDelayMs));
  writeFileSync(
    join(dir, "daemon.json"),
    daemonJson ?? JSON.stringify({ schema_version: "6", daemon: "running" }),
  );
  writeFileSync(join(dir, "daemon.exit"), String(daemonExit));
  writeFileSync(
    join(dir, "voices.json"),
    voicesJson ??
      JSON.stringify({
        schema_version: "6",
        voices: ["default", "ryan", "vivian"],
      }),
  );
  writeFileSync(join(dir, "voices.exit"), String(voicesExit));
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
      'if (argv[0] === "doctor") {',
      '  const delay = Number(fs.readFileSync(path.join(__dirname, "doctor.delay"), "utf8"));',
      "  if (delay > 0) {",
      "    const sab = new Int32Array(new SharedArrayBuffer(4));",
      "    Atomics.wait(sab, 0, 0, delay);",
      "  }",
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "doctor.json"), "utf8"));',
      '  process.exit(Number(fs.readFileSync(path.join(__dirname, "doctor.exit"), "utf8")));',
      "}",
      'if (argv[0] === "voice" && argv[1] === "list") {',
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "voices.json"), "utf8"));',
      '  process.exit(Number(fs.readFileSync(path.join(__dirname, "voices.exit"), "utf8")));',
      "}",
      'if (argv[0] === "daemon" && argv[1] === "status") {',
      '  process.stdout.write(fs.readFileSync(path.join(__dirname, "daemon.json"), "utf8"));',
      '  process.exit(Number(fs.readFileSync(path.join(__dirname, "daemon.exit"), "utf8")));',
      "}",
      "process.exit(0);",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, "ai-voice-interconnector.cmd"),
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    const sh = join(dir, "ai-voice-interconnector");
    // ${0%/*} es expansión de parámetros POSIX (built-in del shell): resuelve
    // el dir del shim sin invocar el binario externo `dirname`, que no está en
    // el PATH acotado del test (solo shim + Node). Con `dirname` los runners
    // POSIX de CI fallaban con «dirname: not found».
    writeFileSync(sh, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(sh, 0o755);
  }
  return { argvLog };
}

/** PATH que resuelve el CLI falso y mantiene `node` disponible para el shim. */
function fakeCliEnv(dir: string): Record<string, string> {
  const p = dir + delimiter + dirname(process.execPath);
  return { PATH: p, Path: p };
}

/** PATH sin `ai-voice-interconnector` (solo el dir del binario de Node). */
function nodeOnlyEnv(): Record<string, string> {
  const p = dirname(process.execPath);
  return { PATH: p, Path: p };
}

function runHealth(
  cliDir: string | null,
  extraEnv: Record<string, string> = {},
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const env = healthEnv({
    ...(cliDir ? fakeCliEnv(cliDir) : nodeOnlyEnv()),
    ...extraEnv,
  });
  const res = spawnSync(process.execPath, [HEALTH], {
    env,
    input: "",
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function loggedArgvs(argvLog: string): string[][] {
  if (!existsSync(argvLog)) return [];
  return readFileSync(argvLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function invoked(argvLog: string, prefix: string[]): boolean {
  return loggedArgvs(argvLog).some((argv) =>
    prefix.every((p, i) => argv[i] === p),
  );
}

function startCount(argvLog: string): number {
  return startArgvs(argvLog).length;
}

function startArgvs(argvLog: string): string[][] {
  return loggedArgvs(argvLog).filter(
    (argv) => argv[0] === "daemon" && argv[1] === "start",
  );
}

/** State dir del plugin dentro del temporal, según el SO real del host. */
function activeVoiceCache(): string {
  const sub =
    process.platform === "darwin" ? join("Library", "Application Support") : "";
  return join(stateBase, sub, "evolutivex-agents", "active-voice");
}

/** Reporte sano del contrato vigente del motor: failed vacío y checks correctos. */
function healthyDoctorJson(): string {
  return JSON.stringify({
    schema_version: "6",
    version: ENGINE_VERSION,
    failed: [],
    checks: [{ name: "install_receipt", ok: true, detail: "recibo válido" }],
    models: { missing: [] },
  });
}

/**
 * Reporte de una instalación `unmanaged` funcional: solo fallan checks
 * informativos (recibo y PATH); los recursos están provisionados.
 */
function informativeDoctorJson(): string {
  return JSON.stringify({
    schema_version: "6",
    version: ENGINE_VERSION,
    channel: "unmanaged",
    failed: ["install_receipt", "path_resolves"],
    checks: [
      {
        name: "install_receipt",
        ok: false,
        detail: "no hay recibo en el directorio de programa",
      },
      {
        name: "path_resolves",
        ok: false,
        detail: "la primera entrada del PATH no es la instalación registrada",
      },
      { name: "models_provisioned", ok: true, detail: "seis modelos" },
    ],
    models: { missing: [] },
  });
}

/** Parsea el stdout del hook como un único objeto con `systemMessage`. */
function systemMessageOf(stdout: string): string {
  const payload = JSON.parse(stdout) as { systemMessage?: unknown };
  assert.equal(typeof payload.systemMessage, "string");
  return payload.systemMessage as string;
}

test("sano + daemon running: no avisa, consulta el estado y no arranca", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warm",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.ok(invoked(argvLog, ["doctor", "--json"]));
    assert.ok(invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("sano + daemon stopped limpio: arranca el daemon exactamente una vez", async () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.ok(invoked(argvLog, ["daemon", "status", "--json"]));
    // El arranque es desanclado: el hijo puede tardar en anotar su argv.
    assert.ok(await waitFor(() => startCount(argvLog) === 1));
    assert.equal(startCount(argvLog), 1);
    // Sin voz en /config: precalienta default de forma explícita y no lista
    // voces.
    assert.deepEqual(startArgvs(argvLog)[0], [
      "daemon",
      "start",
      "--warm-voice",
      "default",
    ]);
    assert.ok(!invoked(argvLog, ["voice", "list"]));
  } finally {
    removeDir(dir);
  }
});

test("sano + daemon stopped degraded: avisa remitiendo a daemon status y no arranca", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "stopped",
        degraded: "unresponsive",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.match(res.stdout, /daemon status/);
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("sano + daemon running warm_failed: avisa del fallo de calentamiento y no arranca", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warm_failed",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("sano + daemon running warming: no avisa ni bloquea ni arranca", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warming",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("sano + daemon status ilegible: avisa remitiendo a daemon status y no arranca", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: "esto no es json",
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.match(res.stdout, /daemon status/);
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + failed no vacío: avisa nombrando todos los checks, sin consultar el daemon", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: JSON.stringify({
        schema_version: "6",
        failed: ["models_provisioned", "install_receipt"],
        checks: [
          {
            name: "models_provisioned",
            ok: false,
            detail: "faltan modelos",
          },
          {
            name: "install_receipt",
            ok: false,
            detail: "recibo ilegible",
          },
        ],
        models: { missing: ["qwen3-tts-0.6b-base"] },
      }),
      doctorExit: 1,
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.match(res.stdout, /models_provisioned/);
    assert.match(res.stdout, /install_receipt/);
    assert.match(res.stdout, /ai-voice-interconnector setup/);
    assert.ok(invoked(argvLog, ["doctor", "--json"]));
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + solo checks informativos + daemon stopped: avisa y arranca el daemon una vez", async () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: informativeDoctorJson(),
      doctorExit: 1,
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("install_receipt"));
    assert.ok(message.includes("path_resolves"));
    assert.ok(message.includes("doctor --json"));
    assert.ok(invoked(argvLog, ["daemon", "status", "--json"]));
    assert.ok(await waitFor(() => startCount(argvLog) === 1));
    assert.equal(startCount(argvLog), 1);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + solo checks informativos + daemon running warm: avisa sin arrancar", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: informativeDoctorJson(),
      doctorExit: 1,
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warm",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(systemMessageOf(res.stdout).includes("install_receipt"));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + solo checks informativos + daemon degraded: un solo systemMessage con ambos avisos, sin arrancar", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: informativeDoctorJson(),
      doctorExit: 1,
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "stopped",
        degraded: "unresponsive",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("install_receipt"));
    assert.ok(message.includes("daemon status --json"));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + solo checks informativos + daemon warm_failed: un solo systemMessage con ambos avisos", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: informativeDoctorJson(),
      doctorExit: 1,
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warm_failed",
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("install_receipt"));
    assert.ok(message.includes("warm_failed"));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + onnx_runtime fallido: avisa sin consultar el daemon", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: JSON.stringify({
        schema_version: "6",
        failed: ["onnx_runtime"],
        checks: [
          { name: "onnx_runtime", ok: false, detail: "no carga la librería" },
        ],
        models: { missing: [] },
      }),
      doctorExit: 1,
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(systemMessageOf(res.stdout).includes("onnx_runtime"));
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 1 + objeto de error doctor_failed: aviso de fallo del diagnóstico, sin consultar el daemon", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: JSON.stringify({
        schema_version: "6",
        error: "no se pudo resolver el ejecutable en ejecución",
        reason: "doctor_failed",
        message: "doctor falló",
      }),
      doctorExit: 1,
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /systemMessage/);
    assert.ok(!res.stdout.includes("setup"));
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 0 + JSON ilegible: sin aviso ni daemon (estado incierto)", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, { doctorJson: "esto no es json" });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("doctor exit 0 con failed no vacío (incoherente): sin daemon ni arranque", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: JSON.stringify({
        schema_version: "6",
        failed: ["models_provisioned"],
        checks: [
          {
            name: "models_provisioned",
            ok: false,
            detail: "faltan modelos",
          },
        ],
        models: { missing: [] },
      }),
    });
    const res = runHealth(dir);
    assert.equal(res.status, 0);
    assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("sin CLI en el PATH: aviso de CLI ausente y exit 0", () => {
  const res = runHealth(null);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /systemMessage/);
  assert.match(res.stdout, /AI Voice-InterConnector/);
});

test(
  "presupuesto: un doctor que supera su timeout no compromete el hook (<30 s)",
  { timeout: 60000 },
  () => {
    const dir = makeTempDir("avi-plugin-health-cli-");
    try {
      // Demora por encima del timeout de doctor (20 s): el hook debe matarlo y
      // terminar bien dentro del timeout de 30 s de SessionStart.
      const { argvLog } = makeFakeCli(dir, {
        doctorJson: healthyDoctorJson(),
        doctorDelayMs: 21000,
      });
      const start = Date.now();
      const res = runHealth(dir);
      const elapsed = Date.now() - start;
      assert.equal(res.status, 0);
      assert.ok(
        elapsed >= 19000,
        `la demora no se aplicó: el hook tardó ${elapsed} ms`,
      );
      assert.ok(
        elapsed < 30000,
        `el hook excedió el presupuesto: ${elapsed} ms`,
      );
      assert.ok(!invoked(argvLog, ["daemon", "status", "--json"]));
    } finally {
      removeDir(dir);
    }
  },
);

// --- Voz activa de /config ---

const VOICES_WITH_MI_VOZ = JSON.stringify({
  schema_version: "6",
  voices: ["default", "ryan", "vivian", "mi_voz"],
});

test("voz activa existente + daemon stopped: arranca con --warm-voice <voz>", async () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
      voicesJson: VOICES_WITH_MI_VOZ,
    });
    const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "Mi_Voz" });
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.ok(invoked(argvLog, ["voice", "list", "--json"]));
    assert.ok(await waitFor(() => startCount(argvLog) === 1));
    assert.deepEqual(startArgvs(argvLog)[0], [
      "daemon",
      "start",
      "--warm-voice",
      "mi_voz",
    ]);
  } finally {
    removeDir(dir);
  }
});

test("voz activa inexistente + daemon stopped: avisa y no arranca", async () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
    });
    const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "mi_voz" });
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("la voz mi_voz no existe"));
    assert.ok(message.includes("evolutivex-agents.voice"));
    assert.ok(message.includes("no se arrancó"));
    // Margen para un arranque desanclado que no debe ocurrir.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("nombre de voz inválido en /config: avisa sin consultar el motor ni arrancar", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
    });
    const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "mi voz/.." });
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("«mi voz/..»"));
    assert.ok(message.includes("no es válido"));
    assert.deepEqual(loggedArgvs(argvLog), []);
  } finally {
    removeDir(dir);
  }
});

for (const [label, opts] of [
  ["voice list con exit 1", { voicesJson: "{}", voicesExit: 1 }],
  ["voice list con JSON inválido", { voicesJson: "esto no es json" }],
] as const) {
  test(`${label}: diagnóstico incierto sin afirmar que la voz falta y sin arrancar`, async () => {
    const dir = makeTempDir("avi-plugin-health-cli-");
    try {
      const { argvLog } = makeFakeCli(dir, {
        doctorJson: healthyDoctorJson(),
        daemonJson: JSON.stringify({ schema_version: "6", daemon: "stopped" }),
        ...opts,
      });
      const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "mi_voz" });
      assert.equal(res.status, 0);
      const message = systemMessageOf(res.stdout);
      assert.ok(message.includes("no se pudo comprobar si la voz mi_voz"));
      assert.ok(!message.includes("no existe"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(startCount(argvLog), 0);
    } finally {
      removeDir(dir);
    }
  });
}

test("daemon corriendo con otra voz caliente: no se reinicia ni avisa", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({
        schema_version: "6",
        daemon: "running",
        warm: "warm",
      }),
      voicesJson: VOICES_WITH_MI_VOZ,
    });
    const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "mi_voz" });
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes("systemMessage"));
    assert.ok(invoked(argvLog, ["voice", "list", "--json"]));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("daemon corriendo y voz inexistente: avisa sin decir que no se arrancó", () => {
  const dir = makeTempDir("avi-plugin-health-cli-");
  try {
    const { argvLog } = makeFakeCli(dir, {
      doctorJson: healthyDoctorJson(),
      daemonJson: JSON.stringify({ schema_version: "6", daemon: "running" }),
    });
    const res = runHealth(dir, { CLAUDE_PLUGIN_OPTION_VOICE: "mi_voz" });
    assert.equal(res.status, 0);
    const message = systemMessageOf(res.stdout);
    assert.ok(message.includes("la voz mi_voz no existe"));
    assert.ok(!message.includes("no se arrancó"));
    assert.equal(startCount(argvLog), 0);
  } finally {
    removeDir(dir);
  }
});

test("escribe la caché de la voz activa, también con la voz desactivada", () => {
  const res = runHealth(null, {
    CLAUDE_PLUGIN_OPTION_VOICEENABLED: "false",
    CLAUDE_PLUGIN_OPTION_VOICE: "mi_voz",
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
  assert.equal(readFileSync(activeVoiceCache(), "utf8").trim(), "mi_voz");
});
