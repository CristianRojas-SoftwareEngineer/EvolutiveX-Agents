// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de SessionStart: verifica una sola vez por sesión que la cadena de
// narración está completa (CLI en PATH + recursos del motor provisionados) y,
// solo en ese caso, deja el daemon en marcha para que `speech say --daemon`
// esté caliente durante la sesión (elimina el arranque manual tras un
// reinicio). El veredicto sale del exit de `doctor --json` más su reporte
// (failed/checks del contrato vigente); ante un check de recursos fallido o un
// estado degradado/incierto del daemon avisa al usuario con el campo
// systemMessage del JSON de salida (único mecanismo de aviso portable). Los
// checks de instalación fallidos (`install_receipt`, `path_*`,
// `pending_artifacts`) se avisan sin impedir el arranque, y ese aviso se
// combina con el del daemon en un único systemMessage. Nunca falla la sesión:
// exit 0 siempre.
import { loadConfig } from "./lib/config.js";
import { resolveCli, runCli } from "./lib/resolve-cli.js";
import { readStdin } from "./lib/hook-payload.js";
import {
  getDaemonStatus,
  startDaemonDetached,
  type DaemonStatusResult,
} from "./lib/daemon.js";
import {
  parseSingleJsonObject,
  decideHealthAction,
} from "./lib/health-decision.js";

/** Emite un aviso systemMessage por stdout al usuario y termina con exit 0. */
function exitWithSystemMessage(message: string): never {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

/** Termina en silencio con exit 0. */
function exitSilently(): never {
  process.exit(0);
}

/** Aviso acotado ante degraded o estado incierto del daemon. */
function daemonStatusMessage(status: DaemonStatusResult): string {
  const reason =
    status.kind === "degraded"
      ? `el daemon reporta degraded (${status.degraded})`
      : "el estado del daemon es incierto";
  return (
    `EvolutiveX Agent: ${reason}. Ejecuta ` +
    "ai-voice-interconnector daemon status --json para diagnosticarlo; " +
    "el daemon no se arrancó."
  );
}

async function main(): Promise<void> {
  await readStdin(); // drena stdin; el contenido no se usa aquí

  const cfg = loadConfig();
  if (!cfg.voiceEnabled) exitSilently();

  const cli = resolveCli();
  if (!cli) {
    exitWithSystemMessage(
      "EvolutiveX Agent: AI Voice-InterConnector no está en el PATH. Instálalo y ejecuta " +
        "ai-voice-interconnector setup para habilitar la narración por voz.",
    );
  }

  // doctor --json imprime el reporte también en el veredicto negativo (exit 1)
  // y en el fallo del comando (doctor_failed); el veredicto sale del exit más
  // el reporte parseado, nunca de un campo status. Presupuesto de SessionStart
  // (timeout 30 s en hooks/hooks.json): doctor ≤20 s + daemon status ≤5 s = 25 s
  // de subprocesses, dejando ≥5 s de margen para arrancar Node, drenar stdin y
  // resolver el CLI.
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });

  // Sin dato accionable (error de ejecución o stdout vacío): incierto, en
  // silencio.
  if (res.error || typeof res.stdout !== "string" || !res.stdout.trim()) {
    exitSilently();
  }

  const exitCode = typeof res.status === "number" ? res.status : null;
  const report = parseSingleJsonObject(res.stdout);
  const decision = decideHealthAction({ exitCode, report });

  // notify: algún check de recursos falló o el diagnóstico falló; aviso sin
  // tocar el daemon. uncertain: sin daemon ni remedio inventado.
  if (decision.kind === "notify") exitWithSystemMessage(decision.message);
  if (decision.kind === "uncertain") exitSilently();

  // Recursos sanos: único camino que consulta y puede calentar el daemon. El
  // aviso de checks de instalación fallidos (si lo hay) viaja con el mensaje
  // del daemon en un único systemMessage.
  const advisory = decision.advisory;
  const finish = (daemonMessage?: string): never => {
    const message = [advisory, daemonMessage].filter(Boolean).join("\n");
    if (message) exitWithSystemMessage(message);
    exitSilently();
  };

  const status = getDaemonStatus(cli);

  if (status.kind === "running") {
    if (status.warm === "warm_failed") {
      finish(
        "EvolutiveX Agent: el daemon está corriendo pero el calentamiento " +
          "del modelo falló (warm_failed); la primera narración puede tardar o " +
          "fallar. Ejecuta ai-voice-interconnector daemon status --json para " +
          "el detalle.",
      );
    }
    // warming, warm o sin warm: no molestar.
    finish();
  }

  if (status.kind === "stopped") {
    // Arranque único, desanclado y best-effort ante el único estado que lo
    // permite.
    startDaemonDetached(cli);
    finish();
  }

  // degraded o uncertain: aviso acotado remitiendo al comando oficial, sin
  // arrancar.
  finish(daemonStatusMessage(status));
}

main().catch(() => process.exit(0));
