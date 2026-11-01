// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Compila los tests de tests/ a bundles en tests/.build/ con esbuild (misma
// dependencia que el build) y los ejecuta con el corredor nativo de Node
// (node --test). Sin framework de testing externo, alineado con el principio
// de no exigir runtime extra.
import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const testsDir = join(root, "tests");
const outDir = join(testsDir, ".build");

const entries = (await readdir(testsDir)).filter((f) => f.endsWith(".test.ts"));
if (entries.length === 0) {
  console.error("No hay archivos *.test.ts en tests/.");
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: entries.map((f) => join(testsDir, f)),
  outdir: outDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  sourcemap: "inline",
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __pathDirname } from "node:path";',
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
});

const compiled = entries.map((f) => join(outDir, f.replace(/\.ts$/, ".js")));
const res = spawnSync(process.execPath, ["--test", ...compiled], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
