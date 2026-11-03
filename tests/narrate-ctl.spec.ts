// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// La superficie que invoca la skill: cada subcomando de narrate-ctl como
// subproceso real sobre dist/narrate-ctl.js (check-dist garantiza que dist/
// refleja src/), con el state dir redirigido a un temporal vía env vars del SO
// anfitrión. El test de status fija por contrato que las claves jamás se
// imprimen y que las preferencias no se muestran (viven en /config). Cubre
// presynth idempotente (solo exit 6 con `label_exists`), presynth --force (que
// pasa --force al motor para reescribir los WAV existentes), la resolución de
// la voz (`--voice`, la caché `active-voice` o `default`) en say, presynth y
// status, y el bloqueo de operaciones manuales ocupado.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { ENGINE_VERSION, makeTempDir, removeDir } from "./helpers.js";
import { ANNOUNCEMENTS } from "../src/voice/message/static-announcements.js";

const CTL = join(process.cwd(), "dist", "narrate-ctl.js");

let stateBase: string;

beforeEach(() => {
  stateBase = makeTempDir("avi-plugin-ctl-");
});

afterEach(() => {
  removeDir(stateBase);
});

/** State dir del plugin dentro del temporal, según el SO real del host. */
function pluginStateDir(): string {
  const sub =
    process.platform === "darwin" ? join("Library", "Application Support") : "";
  return join(stateBase, sub, "evolutivex-agents");
}

/** Simula la caché que escriben los hooks con la voz activa de /config. */
function seedActiveVoice(voice: string): void {
  mkdirSync(pluginStateDir(), { recursive: true });
  writeFileSync(join(pluginStateDir(), "active-voice"), `${voice}\n`);
}

/** Env que redirige el state dir al temporal según el SO real del host. */
function ctlEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GEMINI_API_KEY;
  Object.assign(env, extra);
  if (process.platform === "win32") env.LOCALAPPDATA = stateBase;
  else if (process.platform === "darwin") env.HOME = stateBase;
  else env.XDG_STATE_HOME = stateBase;
  return env;
}

function runCtl(
  args: string[],
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CTL, ...args], {
    env: ctlEnv(extraEnv),
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("status reporta el estado y jamás imprime el valor de una clave", () => {
  const sentinel = "sk-CLAVE-QUE-NO-DEBE-APARECER";
  const res = runCtl(["status"], { GEMINI_API_KEY: sentinel });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /preferencias: {3}\/config → evolutivex-agents\.\*/);
  assert.match(res.stdout, /gemini key: {5}configurada/);
  assert.ok(!res.stdout.includes(sentinel));
  assert.ok(!res.stderr.includes(sentinel));
});

test("status sin GEMINI_API_KEY reporta la clave ausente", () => {
  const res = runCtl(["status"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /gemini key: {5}ausente/);
});

test("status no muestra preferencias: solo remite a /config", () => {
  const res = runCtl(["status"], {
    CLAUDE_PLUGIN_OPTION_VOICEENABLED: "false",
    CLAUDE_PLUGIN_OPTION_MESSAGEMODE: "llm",
  });
  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stdout, /voice|notifications|messageMode|llm/);
  assert.match(res.stdout, /\/config/);
});

test("sin comando equivale a status", () => {
  const res = runCtl([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /preferencias:/);
});

test("un comando desconocido devuelve 2", () => {
  const res = runCtl(["bailar"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Comando desconocido/);
});

for (const retired of [
  ["voice-on"], // subcomando retirado
  ["voice-off"], // subcomando retirado
  ["notifications-on"], // subcomando retirado
  ["notifications-off"], // subcomando retirado
  ["mode", "llm"],
]) {
  test(`el subcomando retirado ${retired[0]} devuelve 2`, () => {
    const res = runCtl(retired);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Comando desconocido/);
  });
}

test("say sin texto devuelve 2 con uso", () => {
  const res = runCtl(["say", "   "]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Uso: say/);
});

test("say sin ai-voice-interconnector en el PATH devuelve 1 con aviso", () => {
  const emptyPath = makeTempDir("avi-plugin-empty-");
  try {
    const res = runCtl(["say", "hola"], { PATH: emptyPath, Path: emptyPath });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no está en el PATH/);
  } finally {
    removeDir(emptyPath);
  }
});

// --- CLI falso: registra argv por invocación y sale con códigos de una secuencia ---

/** Respuesta programada del CLI falso: un exit (6 emite `label_exists`) o exit + stdout. */
type FakeResponse = number | { exit: number; stdout: string };

/**
 * Crea un `ai-voice-interconnector` falso en `dir` (shim .cmd en Windows, script sh en
 * Unix, ambos delegando en un impl Node). Cada invocación anota su argv en
 * `argv.log` y consume la siguiente respuesta de la secuencia (exit 0 si se
 * agota); un exit 6 numérico imprime el envelope de `label_exists`.
 */
function makeFakeCli(dir: string, codes: FakeResponse[]): { argvLog: string } {
  const argvLog = join(dir, "argv.log");
  writeFileSync(join(dir, "seq.json"), JSON.stringify(codes));
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(process.argv.slice(2)) + "\\n");',
      'const seqPath = path.join(__dirname, "seq.json");',
      'const codes = JSON.parse(fs.readFileSync(seqPath, "utf8"));',
      "const next = codes.length ? codes.shift() : 0;",
      "fs.writeFileSync(seqPath, JSON.stringify(codes));",
      'const r = typeof next === "number" ? { exit: next, stdout: next === 6 ? JSON.stringify({ error: "e", reason: "label_exists" }) : "" } : next;',
      "process.stdout.write(r.stdout);",
      "process.exitCode = r.exit;",
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

function loggedArgvs(argvLog: string): string[][] {
  return readFileSync(argvLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}

test("say invoca speech say --text --daemon (contrato §12)", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0]);
    const res = runCtl(["say", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    const [argv] = loggedArgvs(argvLog);
    assert.deepEqual(argv, [
      "speech",
      "say",
      "--text",
      "hola",
      "--voice",
      "default",
      "--daemon",
    ]);
  } finally {
    removeDir(dir);
  }
});

test("presynth pre-sintetiza los seis anuncios con speech synthesize --label --daemon", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: pre-sintetizado /g)?.length, 6);

    const argvs = loggedArgvs(argvLog);
    assert.equal(argvs.length, 6);
    const labels = argvs.map((argv) => {
      assert.deepEqual(argv.slice(0, 2), ["speech", "synthesize"]);
      assert.ok(argv.includes("--daemon"));
      assert.ok(argv.includes("--json"));
      assert.equal(argv[argv.indexOf("--voice") + 1], "default");
      assert.ok(!argv.includes("--force"));
      return argv[argv.indexOf("--label") + 1];
    });
    assert.deepEqual(
      labels.sort(),
      Object.values(ANNOUNCEMENTS)
        .map((a) => a.label)
        .sort(),
    );
  } finally {
    removeDir(dir);
  }
});

test("presynth --force pasa --force al motor y reporta re-sintetizado", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
    const res = runCtl(["presynth", "--force"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: re-sintetizado /g)?.length, 6);

    const argvs = loggedArgvs(argvLog);
    assert.equal(argvs.length, 6);
    for (const argv of argvs) {
      assert.deepEqual(argv.slice(0, 2), ["speech", "synthesize"]);
      assert.ok(argv.includes("--force"));
      assert.ok(argv.includes("--daemon"));
    }
  } finally {
    removeDir(dir);
  }
});

test("presynth con un argumento inválido devuelve 2 con uso", () => {
  const res = runCtl(["presynth", "turbo"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Uso: presynth/);
});

test("presynth es idempotente: exit 6 (label ya existe) cuenta como éxito", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [0, 6, 6, 0, 6, 6]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.match(/: ya pre-sintetizado /g)?.length, 4);
    assert.equal(res.stdout.match(/: pre-sintetizado /g)?.length, 2);
  } finally {
    removeDir(dir);
  }
});

test("presynth propaga el fallo (exit 5, daemon caído) con código ≠ 0", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [
      {
        exit: 5,
        stdout: JSON.stringify({ error: "e", reason: "daemon_unreachable" }),
      },
      0,
      0,
      0,
      0,
      0,
    ]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /exit 5, daemon_unreachable/);
    assert.match(res.stderr, /ai-voice-interconnector daemon start/);
  } finally {
    removeDir(dir);
  }
});

test("presynth sin ai-voice-interconnector en el PATH devuelve 1 con aviso", () => {
  const emptyPath = makeTempDir("avi-plugin-empty-");
  try {
    const res = runCtl(["presynth"], { PATH: emptyPath, Path: emptyPath });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no está en el PATH/);
  } finally {
    removeDir(emptyPath);
  }
});

test("presynth trata un exit 6 con otro reason como fallo", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [
      { exit: 6, stdout: JSON.stringify({ error: "e", reason: "otra_cosa" }) },
      0,
      0,
      0,
      0,
      0,
    ]);
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /fallo \(exit 6, otra_cosa\)/);
  } finally {
    removeDir(dir);
  }
});

// --- Resolución de la voz: --voice, caché de los hooks o default ---

test("say --voice usa la voz indicada, normalizada", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0]);
    seedActiveVoice("otra");
    const res = runCtl(["say", "--voice", "Mi_Voz", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    const [argv] = loggedArgvs(argvLog);
    assert.equal(argv[argv.indexOf("--voice") + 1], "mi_voz");
    assert.match(res.stdout, /voz: mi_voz \(indicada\)/);
  } finally {
    removeDir(dir);
  }
});

for (const [label, args, text, voice] of [
  [
    "un texto que empieza por guion",
    ["say", "-5 grados hoy"],
    "-5 grados hoy",
    "default",
  ],
  ["--voice=<nombre>", ["say", "--voice=otra", "hola"], "hola", "otra"],
  ["--voice tras el texto", ["say", "hola", "--voice", "otra"], "hola", "otra"],
  [
    "-- antes de un texto literal",
    ["say", "--", "--voice", "x"],
    "--voice x",
    "default",
  ],
] as const) {
  test(`say acepta ${label}`, () => {
    const dir = makeTempDir("avi-plugin-fakecli-");
    try {
      const { argvLog } = makeFakeCli(dir, [0]);
      const res = runCtl([...args], fakeCliEnv(dir));
      assert.equal(res.status, 0, res.stderr);
      const [argv] = loggedArgvs(argvLog);
      assert.equal(argv[argv.indexOf("--text") + 1], text);
      assert.equal(argv[argv.indexOf("--voice") + 1], voice);
    } finally {
      removeDir(dir);
    }
  });
}

test("say --voice sin valor devuelve 2 con uso", () => {
  const res = runCtl(["say", "hola", "--voice"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Uso: say/);
});

test("say sin --voice usa la voz de la caché y lo informa", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0]);
    seedActiveVoice("mi_voz");
    const res = runCtl(["say", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    const [argv] = loggedArgvs(argvLog);
    assert.equal(argv[argv.indexOf("--voice") + 1], "mi_voz");
    assert.match(res.stdout, /voz: mi_voz \(según el último evento\)/);
  } finally {
    removeDir(dir);
  }
});

test("say sin --voice ni caché usa default y lo informa", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [0]);
    const res = runCtl(["say", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 0);
    assert.match(res.stdout, /voz: default \(sin datos de \/config todavía\)/);
  } finally {
    removeDir(dir);
  }
});

test("say propaga el exit del motor", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    makeFakeCli(dir, [3]);
    const res = runCtl(["say", "hola"], fakeCliEnv(dir));
    assert.equal(res.status, 3);
  } finally {
    removeDir(dir);
  }
});

for (const [label, args, seed, expected] of [
  ["--voice", ["presynth", "--voice", "mi_voz"], undefined, "mi_voz"],
  ["la caché", ["presynth"], "mi_voz", "mi_voz"],
] as const) {
  test(`presynth usa la voz de ${label} en las seis síntesis`, () => {
    const dir = makeTempDir("avi-plugin-fakecli-");
    try {
      const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
      if (seed) seedActiveVoice(seed);
      const res = runCtl([...args], fakeCliEnv(dir));
      assert.equal(res.status, 0);
      const argvs = loggedArgvs(argvLog);
      assert.equal(argvs.length, 6);
      for (const argv of argvs)
        assert.equal(argv[argv.indexOf("--voice") + 1], expected);
      // El bloqueo se libera al terminar.
      assert.equal(
        existsSync(join(pluginStateDir(), "voice-operation.lock")),
        false,
      );
    } finally {
      removeDir(dir);
    }
  });
}

test("presynth con el bloqueo ocupado por un dueño vivo sale con 6 sin invocar al motor", () => {
  const dir = makeTempDir("avi-plugin-fakecli-");
  try {
    const { argvLog } = makeFakeCli(dir, [0, 0, 0, 0, 0, 0]);
    const lock = join(pluginStateDir(), "voice-operation.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner"), String(process.pid));
    const res = runCtl(["presynth"], fakeCliEnv(dir));
    assert.equal(res.status, 6);
    assert.match(res.stderr, /otra operación de voz en curso/);
    assert.match(res.stderr, /voice-operation\.lock/);
    assert.equal(existsSync(argvLog), false);
    assert.equal(existsSync(lock), true);
  } finally {
    removeDir(dir);
  }
});

test("status muestra la voz activa de la caché con su origen", () => {
  seedActiveVoice("mi_voz");
  const res = runCtl(["status"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /voz activa: {5}mi_voz \(según el último evento\)/);
});

test("status sin caché muestra default sin datos de /config", () => {
  const res = runCtl(["status"]);
  assert.equal(res.status, 0);
  assert.match(
    res.stdout,
    /voz activa: {5}default \(sin datos de \/config todavía\)/,
  );
});

// --- Familia voice: CLI falso programable por comando ---

/** Respuesta de un comando del CLI falso. */
type CmdResponse = { exit: number; stdout: string };

type VoiceCliOptions = {
  /** Versión que informa `version --json` (default: la verificada). */
  version?: string;
  /** Respuestas por `<comando> <subcomando>` (p. ej. "voice clone"). */
  responses?: Record<string, CmdResponse>;
  /** Etiqueta de `speech synthesize` que falla con la respuesta dada. */
  failLabel?: { label: string } & CmdResponse;
};

/**
 * CLI falso que anota su argv en `argv.log` y despacha por comando:
 * `version --json` informa `version`; `<cmd> <sub>` con respuesta programada
 * la imprime y sale con su exit; `speech synthesize` de `failLabel` falla; el
 * resto sale con 0 e imprime `{}`.
 */
function makeVoiceCli(dir: string, opts: VoiceCliOptions = {}): string {
  writeFileSync(
    join(dir, "cfg.json"),
    JSON.stringify({ version: ENGINE_VERSION, responses: {}, ...opts }),
  );
  writeFileSync(
    join(dir, "impl.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify(argv) + "\\n");',
      'const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "cfg.json"), "utf8"));',
      "const reply = (r) => { process.stdout.write(r.stdout); process.exitCode = r.exit; };",
      'const key = argv[0] + " " + argv[1];',
      'if (argv[0] === "version") reply({ exit: 0, stdout: JSON.stringify({ name: "ai-voice-interconnector", version: cfg.version }) });',
      "else if (cfg.responses[key]) reply(cfg.responses[key]);",
      'else if (key === "speech synthesize" && cfg.failLabel && argv[argv.indexOf("--label") + 1] === cfg.failLabel.label) reply(cfg.failLabel);',
      'else reply({ exit: 0, stdout: "{}" });',
    ].join("\n"),
  );
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, "ai-voice-interconnector.cmd"),
      '@node "%~dp0impl.cjs" %*\r\n@exit /b %errorlevel%\r\n',
    );
  } else {
    const sh = join(dir, "ai-voice-interconnector");
    writeFileSync(sh, '#!/bin/sh\nexec node "${0%/*}/impl.cjs" "$@"\n');
    chmodSync(sh, 0o755);
  }
  return join(dir, "argv.log");
}

function argvsOf(argvLog: string): string[][] {
  return existsSync(argvLog) ? loggedArgvs(argvLog) : [];
}

function synthesizeArgvs(argvLog: string): string[][] {
  return argvsOf(argvLog).filter(
    (a) => a[0] === "speech" && a[1] === "synthesize",
  );
}

const CLONE_OK: CmdResponse = {
  exit: 0,
  stdout: JSON.stringify({ name: "mi_voz", speech: "x", precomputed: true }),
};

/** Ejecuta `fn` con un CLI falso de voces en un temporal. */
function withVoiceCli(
  opts: VoiceCliOptions,
  fn: (argvLog: string, env: Record<string, string>) => void,
): void {
  const dir = makeTempDir("avi-plugin-voicecli-");
  try {
    fn(makeVoiceCli(dir, opts), fakeCliEnv(dir));
  } finally {
    removeDir(dir);
  }
}

/** Deja el bloqueo de operaciones manuales con el `owner` indicado. */
function seedLock(owner: string | undefined): string {
  const lock = join(pluginStateDir(), "voice-operation.lock");
  mkdirSync(lock, { recursive: true });
  if (owner !== undefined) writeFileSync(join(lock, "owner"), owner);
  return lock;
}

test("voice clone desde WAV (ruta con espacios) clona con --daemon --json y pre-sintetiza seis veces", () => {
  withVoiceCli({ responses: { "voice clone": CLONE_OK } }, (argvLog, env) => {
    const ref = join(stateBase, "mi referencia", "ref voz.wav");
    const res = runCtl(["voice", "clone", "Mi_Voz", ref], env);
    assert.equal(res.status, 0, res.stderr);
    const clone = argvsOf(argvLog).find((a) => a[0] === "voice");
    assert.deepEqual(clone, [
      "voice",
      "clone",
      "--name",
      "mi_voz",
      "--speech-reference",
      ref,
      "--daemon",
      "--json",
    ]);
    const synth = synthesizeArgvs(argvLog);
    assert.equal(synth.length, 6);
    for (const argv of synth) {
      assert.equal(argv[argv.indexOf("--voice") + 1], "mi_voz");
      assert.ok(argv.includes("--force"));
    }
    assert.match(res.stdout, /evolutivex-agents\.voice = mi_voz/);
    // La pre-síntesis interna reutilizó el bloqueo y se liberó al terminar.
    assert.equal(
      existsSync(join(pluginStateDir(), "voice-operation.lock")),
      false,
    );
  });
});

test("voice clone --mic --duration 10 transmite --force y --denoise", () => {
  withVoiceCli({ responses: { "voice clone": CLONE_OK } }, (argvLog, env) => {
    const res = runCtl(
      [
        "voice",
        "clone",
        "mi_voz",
        "--mic",
        "--duration",
        "10",
        "--force",
        "--denoise",
      ],
      env,
    );
    assert.equal(res.status, 0, res.stderr);
    const clone = argvsOf(argvLog).find((a) => a[0] === "voice");
    assert.deepEqual(clone, [
      "voice",
      "clone",
      "--name",
      "mi_voz",
      "--mic",
      "--duration",
      "10",
      "--force",
      "--denoise",
      "--daemon",
      "--json",
    ]);
    assert.equal(synthesizeArgvs(argvLog).length, 6);
  });
});

test("voice clone con una pre-síntesis fallida sale ≠ 0, informa la etiqueta y no indica /config", () => {
  withVoiceCli(
    {
      responses: { "voice clone": CLONE_OK },
      failLabel: {
        label: "voice-stop",
        exit: 5,
        stdout: JSON.stringify({ error: "e", reason: "daemon_unreachable" }),
      },
    },
    (argvLog, env) => {
      const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /voice-stop/);
      assert.match(res.stderr, /presynth --voice mi_voz --force/);
      assert.doesNotMatch(res.stdout, /evolutivex-agents\.voice =/);
      assert.equal(synthesizeArgvs(argvLog).length, 6);
    },
  );
});

test("voice clone sobre una voz existente sin --force sale con 6 y ofrece --force", () => {
  withVoiceCli(
    {
      responses: {
        "voice clone": {
          exit: 6,
          stdout: JSON.stringify({ error: "existe", reason: "voice_exists" }),
        },
      },
    },
    (argvLog, env) => {
      const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
      assert.equal(res.status, 6);
      assert.match(res.stderr, /--force/);
      assert.equal(synthesizeArgvs(argvLog).length, 0);
    },
  );
});

test("voice clone con un reason desconocido conserva el exit con un mensaje genérico", () => {
  withVoiceCli(
    {
      responses: {
        "voice clone": {
          exit: 9,
          stdout: JSON.stringify({ error: "raro", reason: "algo_nuevo" }),
        },
      },
    },
    (_argvLog, env) => {
      const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
      assert.equal(res.status, 9);
      assert.match(res.stderr, /exit 9 \(algo_nuevo\)/);
    },
  );
});

for (const [label, args] of [
  ["clonar una voz de fábrica", ["voice", "clone", "Default", "ref.wav"]],
  ["clonar ryan", ["voice", "clone", "ryan", "--mic", "--duration", "5"]],
  ["--mic sin --duration sin terminal", ["voice", "clone", "mi_voz", "--mic"]],
  ["voice remove sin --yes", ["voice", "remove", "mi_voz"]],
  ["voice clone sin fuente", ["voice", "clone", "mi_voz"]],
  [
    "voice clone con dos fuentes",
    ["voice", "clone", "mi_voz", "a.wav", "--mic"],
  ],
  [
    "--duration sin --mic",
    ["voice", "clone", "mi_voz", "a.wav", "--duration", "10"],
  ],
  ["un subcomando de voice desconocido", ["voice", "bailar"]],
] as const) {
  test(`${label}: exit 2 sin invocar al motor`, () => {
    withVoiceCli({}, (argvLog, env) => {
      const res = runCtl([...args], env);
      assert.equal(res.status, 2);
      assert.deepEqual(argvsOf(argvLog), []);
    });
  });
}

test("los errores propios del plugin dan los mensajes de la spec", () => {
  const factory = runCtl(["voice", "clone", "vivian", "ref.wav"]);
  assert.match(factory.stderr, /voces de fábrica; elige otro nombre/);
  const mic = runCtl(["voice", "clone", "mi_voz", "--mic"]);
  assert.match(mic.stderr, /--duration <segs>.*push-to-talk/);
  const remove = runCtl(["voice", "remove", "mi_voz"]);
  assert.match(remove.stderr, /Confirma el borrado con `--yes`/);
});

test("voice list marca las voces de fábrica y la activa según la caché", () => {
  withVoiceCli(
    {
      responses: {
        "voice list": {
          exit: 0,
          stdout: JSON.stringify({
            schema_version: "6",
            voices: ["default", "ryan", "vivian", "mi_voz", "otra"],
          }),
        },
      },
    },
    (argvLog, env) => {
      seedActiveVoice("mi_voz");
      const res = runCtl(["voice", "list"], env);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /^ {2}default \(fábrica\)$/m);
      assert.match(res.stdout, /^ {2}mi_voz \(activa\)$/m);
      assert.match(res.stdout, /^ {2}otra$/m);
      assert.ok(
        argvsOf(argvLog).some((a) => a.join(" ") === "voice list --json"),
      );
    },
  );
});

test("voice list con JSON inválido sale con 1", () => {
  withVoiceCli(
    { responses: { "voice list": { exit: 0, stdout: "no es json" } } },
    (_argvLog, env) => {
      const res = runCtl(["voice", "list"], env);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /respuesta inesperada/);
    },
  );
});

test("voice remove --yes borra, informa las locuciones y advierte si es la voz activa", () => {
  withVoiceCli(
    {
      responses: {
        "voice remove": {
          exit: 0,
          stdout: JSON.stringify({
            status: "removed",
            voice: "mi_voz",
            removed_speech: ["voice-stop", "voice-subagent-stop"],
          }),
        },
      },
    },
    (argvLog, env) => {
      seedActiveVoice("mi_voz");
      const res = runCtl(["voice", "remove", "mi_voz", "--yes"], env);
      assert.equal(res.status, 0, res.stderr);
      assert.ok(
        argvsOf(argvLog).some(
          (a) => a.join(" ") === "voice remove --name mi_voz --yes --json",
        ),
      );
      assert.match(res.stdout, /voice-stop, voice-subagent-stop/);
      assert.match(res.stdout, /es la voz activa/);
    },
  );
});

test("voice remove de una voz que no es la activa no advierte", () => {
  withVoiceCli(
    {
      responses: {
        "voice remove": {
          exit: 0,
          stdout: JSON.stringify({
            status: "removed",
            voice: "otra",
            removed_speech: [],
          }),
        },
      },
    },
    (_argvLog, env) => {
      seedActiveVoice("mi_voz");
      const res = runCtl(["voice", "remove", "otra", "--yes"], env);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /locuciones borradas: ninguna/);
      assert.doesNotMatch(res.stdout, /voz activa/);
    },
  );
});

test("voice remove de una voz de fábrica: el motor la protege y sale con 2", () => {
  withVoiceCli(
    {
      responses: {
        "voice remove": {
          exit: 2,
          stdout: JSON.stringify({
            error: "no",
            reason: "cannot_remove_default",
          }),
        },
      },
    },
    (_argvLog, env) => {
      const res = runCtl(["voice", "remove", "default", "--yes"], env);
      assert.equal(res.status, 2);
      assert.match(res.stderr, /fábrica no se pueden borrar/);
    },
  );
});

for (const version of ["0.41.9", "abc"]) {
  test(`motor con versión ${version}: voice * sale con 1 sin invocar voice`, () => {
    withVoiceCli({ version }, (argvLog, env) => {
      for (const args of [
        ["voice", "list"],
        ["voice", "clone", "mi_voz", "ref.wav"],
        ["voice", "remove", "mi_voz", "--yes"],
      ]) {
        const res = runCtl(args, env);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /requiere AI Voice-InterConnector 0\.42\.0/);
      }
      assert.ok(argvsOf(argvLog).every((a) => a[0] === "version"));
    });
  });
}

test("voice clone con el bloqueo de un dueño vivo sale con 6 sin clonar", () => {
  withVoiceCli({ responses: { "voice clone": CLONE_OK } }, (argvLog, env) => {
    seedLock(String(process.pid));
    const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
    assert.equal(res.status, 6);
    assert.ok(!argvsOf(argvLog).some((a) => a[0] === "voice"));
  });
});

test("voice clone con un owner ilegible sale con 6 y conserva el bloqueo", () => {
  withVoiceCli({ responses: { "voice clone": CLONE_OK } }, (argvLog, env) => {
    const lock = seedLock(undefined);
    const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
    assert.equal(res.status, 6);
    assert.equal(existsSync(lock), true);
    assert.ok(!argvsOf(argvLog).some((a) => a[0] === "voice"));
  });
});

test("voice remove con un bloqueo de dueño muerto lo retira y sigue", () => {
  withVoiceCli(
    {
      responses: {
        "voice remove": {
          exit: 0,
          stdout: JSON.stringify({ removed_speech: [] }),
        },
      },
    },
    (_argvLog, env) => {
      const lock = seedLock("999999");
      const res = runCtl(["voice", "remove", "mi_voz", "--yes"], env);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(existsSync(lock), false);
    },
  );
});

test("voice clone libera el bloqueo aunque el motor falle", () => {
  withVoiceCli(
    {
      responses: {
        "voice clone": {
          exit: 3,
          stdout: JSON.stringify({ error: "e", reason: "audio_not_found" }),
        },
      },
    },
    (_argvLog, env) => {
      const res = runCtl(["voice", "clone", "mi_voz", "ref.wav"], env);
      assert.equal(res.status, 3);
      assert.match(res.stderr, /La ruta de referencia no existe/);
      assert.equal(
        existsSync(join(pluginStateDir(), "voice-operation.lock")),
        false,
      );
    },
  );
});
