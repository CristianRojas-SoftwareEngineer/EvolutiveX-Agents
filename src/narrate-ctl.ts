// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Superficie de control de la narración y las notificaciones (para la skill y uso manual).
// Lee y escribe config.json en el state dir: solo preferencias no secretas
// (voiceEnabled, notificationsEnabled y messageMode). La API key se lee del entorno.
// No participa en el flujo de hooks.
//
// Uso: node dist/narrate-ctl.js <comando> [args]
//   voice-on           activa la narración por voz
//   voice-off          desactiva la narración por voz
//   notifications-on   activa las notificaciones de escritorio
//   notifications-off  desactiva las notificaciones de escritorio
//   mode <llm|local>   fija el modo de generación
//   status             muestra el estado (sin revelar las claves)
//   say "<texto>"      narra un texto a demanda vía ai-voice-interconnector
//   presynth [--force] pre-sintetiza los anuncios estáticos (idempotente; --force reescribe)
import { loadConfig, updateConfig } from "./lib/config.js";
import { configPath, stateDir } from "./lib/state-dir.js";
import { resolveCli, runCli } from "./lib/resolve-cli.js";
import { ANNOUNCEMENTS } from "./message/static-announcements.js";

function printStatus(): void {
  const cfg = loadConfig();
  const lines = [
    `voice:          ${cfg.voiceEnabled}`,
    `notifications:  ${cfg.notificationsEnabled}`,
    `messageMode:    ${cfg.messageMode}`,
    `gemini key:     ${cfg.geminiApiKey ? "configurada" : "ausente"}`,
    `config:         ${configPath()}`,
    `state dir:      ${stateDir()}`,
  ];
  console.log(lines.join("\n"));
}

function say(text: string): number {
  const cli = resolveCli();
  if (!cli) {
    console.error(
      "ai-voice-interconnector no está en el PATH; no se puede narrar.",
    );
    return 1;
  }
  const res = runCli(cli, ["speech", "say", "--text", text, "--daemon"], {
    stdio: "inherit",
    windowsHide: true,
  });
  return res.status ?? 0;
}

/**
 * Pre-sintetiza los anuncios del catálogo con `speech synthesize --daemon`.
 * Idempotente por defecto: la colisión de label (exit `6`) significa «ya
 * pre-sintetizado» y cuenta como éxito. Con `force`, pasa `--force` al motor
 * para sobrescribir el WAV del label existente: el re-sync manual tras un
 * cambio de frase (el label es fijo, así que `presynth` a secas no lo
 * detectaría). Requiere el daemon caliente (exit `5` si está caído) y el modelo
 * provisionado (exit `4`).
 */
function presynth(force: boolean): number {
  const cli = resolveCli();
  if (!cli) {
    console.error(
      "ai-voice-interconnector no está en el PATH; no se puede pre-sintetizar.",
    );
    return 1;
  }
  let failed = false;
  for (const [eventKey, { text, label }] of Object.entries(ANNOUNCEMENTS)) {
    const args = ["speech", "synthesize", "--text", text, "--label", label];
    if (force) args.push("--force");
    args.push("--daemon");
    const res = runCli(cli, args, {
      stdio: ["ignore", "ignore", "inherit"],
      windowsHide: true,
    });
    const code = res.status ?? 1;
    if (code === 0)
      console.log(
        `${eventKey}: ${force ? "re-sintetizado" : "pre-sintetizado"} (${label})`,
      );
    else if (code === 6)
      console.log(`${eventKey}: ya pre-sintetizado (${label})`);
    else {
      failed = true;
      const reason =
        code === 5
          ? " — daemon caído; levántalo con `ai-voice-interconnector daemon start`"
          : code === 4
            ? " — modelo ausente; provisiónalo con `ai-voice-interconnector setup`"
            : "";
      console.error(`${eventKey}: fallo (exit ${code})${reason}`);
    }
  }
  return failed ? 1 : 0;
}

function main(): number {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "voice-on":
      updateConfig({ voiceEnabled: true });
      console.log("Narración activada.");
      return 0;
    case "voice-off":
      updateConfig({ voiceEnabled: false });
      console.log("Narración desactivada.");
      return 0;
    case "notifications-on":
      updateConfig({ notificationsEnabled: true });
      console.log("Notificaciones de escritorio activadas.");
      return 0;
    case "notifications-off":
      updateConfig({ notificationsEnabled: false });
      console.log("Notificaciones de escritorio desactivadas.");
      return 0;
    case "mode": {
      const mode = rest[0];
      if (mode !== "llm" && mode !== "local") {
        console.error("Uso: mode <llm|local>");
        return 2;
      }
      updateConfig({ messageMode: mode });
      console.log(`messageMode = ${mode}`);
      return 0;
    }
    case "status":
    case undefined:
      printStatus();
      return 0;
    case "say": {
      const text = rest.join(" ").trim();
      if (!text) {
        console.error('Uso: say "<texto>"');
        return 2;
      }
      return say(text);
    }
    case "presynth": {
      const force = rest[0] === "--force" || rest[0] === "-f";
      if (rest.length > 1 || (rest.length === 1 && !force)) {
        console.error("Uso: presynth [--force]");
        return 2;
      }
      return presynth(force);
    }
    default:
      console.error(`Comando desconocido: ${cmd}`);
      return 2;
  }
}

process.exit(main());
