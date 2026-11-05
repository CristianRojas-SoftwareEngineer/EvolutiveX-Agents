// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Compila los entry points de src/ a bundles autocontenidos en dist/ con esbuild
// y sincroniza los binarios redistribuibles de node-notifier en vendor/.
// Sin --check: escribe dist/ y vendor/. Con --check: verifica que dist/ y vendor/
// están sincronizados con src/ (usado por CI) sin tocar el árbol.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "dist");
const vendorSrcDir = join(root, "node_modules", "node-notifier", "vendor");
const vendorOutDir = join(root, "vendor");
const excludedAppleIcon = join(
  vendorOutDir,
  "mac.noindex",
  "terminal-notifier.app",
  "Contents",
  "Resources",
  "Terminal.icns",
);
const REQUIRED_VENDOR_FILES = [
  join("snoreToast", "snoretoast-x64.exe"),
  join("snoreToast", "snoretoast-x86.exe"),
  join("snoreToast", "LICENSE"),
  join("notifu", "notifu.exe"),
  join("notifu", "notifu64.exe"),
  join("notifu", "LICENSE"),
  join(
    "mac.noindex",
    "terminal-notifier.app",
    "Contents",
    "MacOS",
    "terminal-notifier",
  ),
  "terminal-notifier-LICENSE",
];

const ENTRY_POINTS = {
  "narrate-hook": "src/voice/narrate-hook.ts",
  "narrate-worker": "src/voice/narrate-worker.ts",
  "health-check": "src/voice/health-check.ts",
  "narrate-ctl": "src/narrate-ctl.ts",
  "notification-hook": "src/notifications/notification-hook.ts",
  "notification-deliver": "src/notifications/deliver-entry.ts",
  "notification-cli": "src/notifications/cli.ts",
  "notification-register": "src/notifications/register.ts",
};

// Reglas de arquitectura verificadas contra el grafo real de cada bundle
// (metafile de esbuild): el hook solo decide y despacha, así que no contiene
// código de entrega; y los bundles del canal de notificaciones no contienen
// el canal de voz.
const HOOK_FORBIDDEN = [
  "node_modules/node-notifier/",
  "node_modules/commander/",
  "src/notifications/desktop-notification-adapter.ts",
];
const VOICE_FREE_BUNDLES = [
  "notification-hook",
  "notification-deliver",
  "notification-cli",
  "notification-register",
];

/** Violaciones de las reglas de dependencia; cada una nombra bundle y módulo. */
function architectureViolations(metafile) {
  const violations = [];
  const inputsOf = (bundle) =>
    Object.entries(metafile.outputs)
      .filter(
        ([out]) =>
          relative(distDir, join(root, out)).replaceAll("\\", "/") ===
          `${bundle}.js`,
      )
      .flatMap(([, meta]) => Object.keys(meta.inputs));
  for (const input of inputsOf("notification-hook")) {
    const forbidden = HOOK_FORBIDDEN.find((f) => input.includes(f));
    if (forbidden) {
      violations.push(
        `notification-hook incluye ${input}: el hook solo decide y despacha, no puede contener código de entrega`,
      );
    }
  }
  for (const bundle of VOICE_FREE_BUNDLES) {
    for (const input of inputsOf(bundle)) {
      if (input.startsWith("src/voice/")) {
        violations.push(
          `${bundle} incluye ${input}: los bundles de notificaciones no pueden contener src/voice/`,
        );
      }
    }
  }
  return violations;
}

/** @type {import("esbuild").BuildOptions} */
const baseOptions = {
  metafile: true,
  entryPoints: Object.fromEntries(
    Object.entries(ENTRY_POINTS).map(([name, path]) => [
      name,
      join(root, path),
    ]),
  ),
  outdir: distDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  sourcemap: false,
  // Bundle autocontenido: empaqueta commander y node-notifier dentro de dist/
  // e inyecta createRequire/__dirname para módulos CJS empacados en ESM.
  banner: {
    js: [
      "// Generado por build.mjs (esbuild). No editar a mano; editar src/ y recompilar.",
      'import { createRequire as __createRequire } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __pathDirname } from "node:path";',
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
};

// Transcript enriquecido: se ejecuta en el sandbox de function hooks de Claude
// Code (sin Node ni sistema de archivos), así que se empaqueta neutral y sin
// el banner de Node.
/** @type {import("esbuild").BuildOptions} */
const transcriptOptions = {
  entryPoints: { transcript: join(root, "src/transcript/index.ts") },
  outdir: distDir,
  bundle: true,
  platform: "neutral",
  format: "esm",
  minify: false,
  sourcemap: false,
};

const isCheck = process.argv.includes("--check");

if (isCheck) {
  const results = await Promise.all([
    build({ ...baseOptions, write: false }),
    build({ ...transcriptOptions, write: false }),
  ]);
  let drift = false;
  const violations = architectureViolations(results[0].metafile);
  for (const violation of violations) {
    drift = true;
    console.error(`regla de arquitectura violada: ${violation}`);
  }
  for (const out of results.flatMap((result) => result.outputFiles)) {
    const rel = relative(distDir, out.path);
    let current = "";
    try {
      current = await readFile(out.path, "utf8");
    } catch {
      current = "\0__MISSING__";
    }
    if (current !== out.text) {
      drift = true;
      console.error(
        `dist desincronizado: ${rel} difiere de la compilación de src/`,
      );
    }
  }
  const missingVendor = REQUIRED_VENDOR_FILES.filter(
    (relPath) => !existsSync(join(vendorOutDir, relPath)),
  );
  if (missingVendor.length > 0 || existsSync(excludedAppleIcon)) {
    drift = true;
    console.error("vendor/ desincronizado o contiene recursos excluidos.");
  }
  if (drift) {
    console.error("\nEjecuta `npm run build` y commitea dist/ y vendor/.");
    process.exit(1);
  }
  console.log("dist/ está sincronizado con src/.");
} else {
  await Promise.all([build(baseOptions), build(transcriptOptions)]);
  if (existsSync(vendorSrcDir)) {
    await rm(vendorOutDir, { recursive: true, force: true });
    await cp(vendorSrcDir, vendorOutDir, { recursive: true });
    await rm(excludedAppleIcon, { force: true });
  }
  console.log(
    `Compilados ${Object.keys(ENTRY_POINTS).length + 1} bundles en dist/.`,
  );
}
