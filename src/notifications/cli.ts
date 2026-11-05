// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Entry point CLI standalone (diagnóstico). Entrega en el mismo proceso con el
// núcleo de entrega: espera y reporta los fallos, y deja su línea en notification.log.
import { Command, Option } from "commander";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath, basename } from "node:path";
import { readStdin } from "../lib/hook-payload.js";
import { ensureStateDir } from "../lib/state-dir.js";
import { deliver } from "./delivery.js";
import { createDeliveryDeps } from "./delivery-runtime.js";
import {
  buildNotificationPayload,
  DEFAULT_APP_ID,
  resolveEventKey,
  normalizeStdinJsonText,
} from "./notification-payload.js";
import type { CliOptions } from "./notification-payload.js";

const SOUND_FLAG = "sound";
const SILENT_FLAG = "silent";
const STDIN_JSON_FLAG = "stdin-json";
const APP_ID_FLAG = "app-id";
const ICON_FLAG = "icon";

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("notification-cli")
    .description("Emite un toast nativo del SO desde un hook de Claude Code")
    .option("--event-type <type>", "Tipo de evento del lifecycle (p. ej. Stop)")
    .option(
      "--message <msg>",
      "Cuerpo del toast (override; por defecto catálogo o formatter stdin)",
    )
    .option(
      "--title <title>",
      "Título del toast (override; por defecto nombre del hook)",
    )
    .addOption(
      new Option(`--${SOUND_FLAG}`, "Reproducir sonido genérico").conflicts(
        SILENT_FLAG,
      ),
    )
    .addOption(
      new Option(`--${SILENT_FLAG}`, "Silenciar el toast").conflicts(
        SOUND_FLAG,
      ),
    )
    .option(
      `--${STDIN_JSON_FLAG}`,
      "Leer payload JSON por stdin y derivar mensaje dinámico",
    )
    .option(
      `--${APP_ID_FLAG} <id>`,
      `Identificador de aplicación (AUMID Windows); default: ${DEFAULT_APP_ID}`,
    )
    .option(
      `--${ICON_FLAG} <path>`,
      "Ruta al icono de la notificación; default: perfil del evento o ai-assistant.png",
    )
    .allowExcessArguments(false)
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  options.sound = Boolean(options.sound);
  options.silent = Boolean(options.silent);
  options.stdinJson = Boolean(options.stdinJson);

  let stdinPayload: Record<string, unknown> | undefined;
  if (options.stdinJson) {
    let raw: string;
    try {
      raw = await readStdin();
    } catch (err) {
      process.stderr.write(`Error leyendo stdin: ${(err as Error).message}\n`);
      return 1;
    }
    try {
      const parsed: unknown = JSON.parse(normalizeStdinJsonText(raw));
      if (typeof parsed !== "object" || parsed === null) {
        process.stderr.write(
          "Payload de stdin inválido: no es un objeto JSON\n",
        );
        return 1;
      }
      stdinPayload = parsed as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(
        `Payload de stdin no parseable como JSON: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  const built = buildNotificationPayload(options, stdinPayload);
  if ("error" in built) {
    process.stderr.write(`${built.error}\n`);
    return 1;
  }

  try {
    ensureStateDir();
  } catch {
    // Sin directorio de estado el log no escribe, pero la entrega sigue.
  }
  const result = await deliver(
    { event: resolveEventKey(options, stdinPayload) ?? "cli", payload: built },
    createDeliveryDeps(),
  );
  if (!result.ok) {
    process.stderr.write(`Error emitiendo notificación: ${result.error}\n`);
    return 1;
  }
  return 0;
}

// Auto-ejecutar solo cuando este módulo es el entry point (evita que
// `import` desde tests dispare `main()` + `process.exit()`).
const isEntryPoint =
  typeof process.argv[1] === "string" &&
  ["notification-cli.js", "cli.ts"].includes(basename(process.argv[1])) &&
  fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);

if (isEntryPoint) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`Error inesperado: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
