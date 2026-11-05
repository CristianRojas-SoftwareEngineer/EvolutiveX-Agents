// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Log con rotación compartido por worker.log y notification.log: rota por
// tamaño, caduca el archivo rotado por antigüedad y nunca lanza.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendRotatingLog } from "../src/lib/rotating-log.js";
import { makeTempDir, removeDir } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

function options(maxBytes = 100, rotatedMaxAgeMs = 1000) {
  const dir = makeTempDir("avi-plugin-rotlog-");
  dirs.push(dir);
  return {
    path: join(dir, "x.log"),
    rotatedPath: join(dir, "x.log.1"),
    maxBytes,
    rotatedMaxAgeMs,
  };
}

test("añade una línea con marca de tiempo ISO", () => {
  const o = options();
  appendRotatingLog(o, "hola");
  assert.match(
    readFileSync(o.path, "utf8"),
    /^\d{4}-\d\d-\d\dT[\d:.]+Z hola\n$/,
  );
});

test("rota al superar el tamaño: el actual pasa a .1 y reemplaza al anterior", () => {
  const o = options(100);
  writeFileSync(o.rotatedPath, "generación vieja\n");
  writeFileSync(o.path, "x".repeat(101));
  appendRotatingLog(o, "nueva");
  assert.equal(readFileSync(o.rotatedPath, "utf8"), "x".repeat(101));
  assert.match(readFileSync(o.path, "utf8"), / nueva\n$/);
});

test("no rota mientras no supere el tamaño", () => {
  const o = options(1000);
  appendRotatingLog(o, "uno");
  appendRotatingLog(o, "dos");
  assert.equal(existsSync(o.rotatedPath), false);
  assert.equal(readFileSync(o.path, "utf8").split("\n").length, 3);
});

test("el archivo rotado caduca tras su antigüedad máxima", () => {
  const o = options(1_000_000, 1000);
  writeFileSync(o.rotatedPath, "viejo\n");
  const old = new Date(Date.now() - 60_000);
  utimesSync(o.rotatedPath, old, old);
  appendRotatingLog(o, "x");
  assert.equal(existsSync(o.rotatedPath), false);

  writeFileSync(o.rotatedPath, "reciente\n");
  appendRotatingLog(o, "y");
  assert.equal(existsSync(o.rotatedPath), true);
});

test("nunca lanza, ni con un directorio inexistente", () => {
  const o = options();
  assert.doesNotThrow(() =>
    appendRotatingLog(
      {
        ...o,
        path: join(o.path, "no", "existe", "x.log"),
        rotatedPath: join(o.path, "no", "existe", "x.log.1"),
      },
      "x",
    ),
  );
});
