// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de SessionStart: verifica una sola vez por sesión que la cadena de
// narración está completa (CLI en PATH + recursos del motor provisionados +
// voz activa existente) y deja el daemon en marcha precalentando la voz
// activa (`daemon start --warm-voice <voz>`) para que `speech say --daemon`
// esté caliente durante la sesión. Si la voz activa no existe en el motor o
// `voice list` es incierto, lo avisa y arranca el daemon precalentando
// `default`, para que clonar y pre-sintetizar funcionen; la narración sigue
// pidiendo la voz elegida. También escribe la caché de la voz activa para
// narrate-ctl. El veredicto sale del exit de `doctor --json` más su reporte
// (failed/checks del contrato vigente); ante un check de recursos fallido, un
// estado degradado/incierto del daemon o una voz activa fuera de las opciones
// de /config avisa al usuario con el campo systemMessage del JSON de salida
// (único mecanismo de aviso portable) y no arranca el daemon. Los checks de
// instalación fallidos
// (`install_receipt`, `path_*`, `pending_artifacts`) se avisan sin impedir el
// arranque, y ese aviso se combina con el del daemon o la voz en un único
// systemMessage. Nunca falla la sesión: exit 0 siempre.
import { loadConfig } from "../lib/config.js";
import { resolveCli, runCli } from "./resolve-cli.js";
import { readStdin } from "../lib/hook-payload.js";
import {
  getDaemonStatus,
  startDaemonDetached,
  type DaemonStatusResult,
} from "./daemon.js";
import {
  parseSingleJsonObject,
  decideHealthAction,
} from "./health-decision.js";
import { writeActiveVoice } from "./active-voice.js";
import {
  CUSTOM_VOICE,
  DEFAULT_VOICE,
  SELECTABLE_VOICES,
  isSelectableVoice,
  parseVoiceList,
} from "./voice.js";

// Presupuesto de SessionStart (timeout 30 s en hooks/hooks.json): un deadline
// global de 28 s acota cada consulta al motor (doctor ≤20 s, daemon status
// ≤5 s, voice list ≤2 s), de modo que ninguna supera el tiempo restante y
// queda margen para arrancar Node, drenar stdin y resolver el CLI.
const DEADLINE_MS = 28_000;
const DOCTOR_TIMEOUT_MS = 20_000;
const DAEMON_STATUS_TIMEOUT_MS = 5_000;
const VOICE_LIST_TIMEOUT_MS = 2_000;

const deadline = Date.now() + DEADLINE_MS;

/**
 * Timeout de una consulta: el menor entre el propio y el tiempo restante del
 * deadline. Nunca 0 (spawnSync lo interpreta como «sin timeout»): con el
 * deadline agotado, 1 ms hace que la consulta falle y cuente como incierta.
 */
function budget(ms: number): number {
  return Math.max(1, Math.min(ms, deadline - Date.now()));
}

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
    `EvolutiveX Agents: ${reason}. Ejecuta ` +
    "ai-voice-interconnector daemon status --json para diagnosticarlo; " +
    "el daemon no se arrancó."
  );
}

/** Resultado de comprobar la voz activa con `voice list --json`. */
type VoiceCheck = "present" | "absent" | "uncertain";

/** ¿La voz existe en el motor? Un listado fallido o ilegible es incierto. */
function checkVoice(cli: string, voice: string): VoiceCheck {
  if (voice === DEFAULT_VOICE) return "present";
  const res = runCli(cli, ["voice", "list", "--json"], {
    encoding: "utf8",
    timeout: budget(VOICE_LIST_TIMEOUT_MS),
    windowsHide: true,
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string")
    return "uncertain";
  const voices = parseVoiceList(res.stdout);
  if (!voices) return "uncertain";
  return voices.includes(voice) ? "present" : "absent";
}

/** Aviso ante una voz activa inexistente o no comprobable. */
function voiceCheckMessage(
  voice: string,
  check: "absent" | "uncertain",
  daemonStarted: boolean,
): string {
  const base =
    check === "uncertain"
      ? `EvolutiveX Agents: no se pudo comprobar si la voz ${voice} existe. ` +
        "Ejecuta ai-voice-interconnector voice list --json para diagnosticarlo."
      : voice === CUSTOM_VOICE
        ? "EvolutiveX Agents: elegiste la voz custom, pero todavía no está " +
          "clonada; clónala con /evolutivex-agents:voice clone o elige otra " +
          "en /config → evolutivex-agents.voice."
        : `EvolutiveX Agents: la voz ${voice} no existe; elige otra en ` +
          "/config → evolutivex-agents.voice.";
  return daemonStarted
    ? `${base} El daemon se arrancó precalentando ${DEFAULT_VOICE}, sin ` +
        "cambiar la voz de la narración."
    : base;
}

/**
 * Aviso del daemon según su estado, arrancándolo si está parado. undefined si
 * no hay nada que avisar.
 */
function handleDaemon(
  cli: string,
  voice: string,
  status: DaemonStatusResult,
): string | undefined {
  if (status.kind === "running") {
    // warming, warm o sin warm: no molestar. El daemon no se reinicia aunque
    // tenga caliente otra voz.
    if (status.warm !== "warm_failed") return undefined;
    return (
      "EvolutiveX Agents: el daemon está corriendo pero el calentamiento " +
      "del modelo falló (warm_failed); la primera narración puede tardar o " +
      "fallar. Ejecuta ai-voice-interconnector daemon status --json para " +
      "el detalle."
    );
  }
  if (status.kind === "stopped") {
    // Arranque único, desanclado y best-effort ante el único estado que lo
    // permite, con la voz activa ya validada (si falta o es incierta, el
    // arranque con default ocurre antes, en checkDaemonAndVoice).
    startDaemonDetached(cli, voice);
    return undefined;
  }
  // degraded o uncertain: aviso acotado remitiendo al comando oficial, sin
  // arrancar.
  return daemonStatusMessage(status);
}

/**
 * Con recursos sanos: consulta el daemon, valida la voz activa si el daemon
 * está running o stopped limpio y gestiona el daemon. Si la voz falta o es
 * incierta y el daemon está parado, lo arranca precalentando `default` solo
 * para las operaciones manuales (clonar, pre-sintetizar). Devuelve el aviso,
 * si lo hay.
 */
function checkDaemonAndVoice(cli: string, voice: string): string | undefined {
  const status = getDaemonStatus(cli, budget(DAEMON_STATUS_TIMEOUT_MS));
  if (status.kind === "running" || status.kind === "stopped") {
    const check = checkVoice(cli, voice);
    if (check !== "present") {
      const stopped = status.kind === "stopped";
      if (stopped) startDaemonDetached(cli, DEFAULT_VOICE);
      return voiceCheckMessage(voice, check, stopped);
    }
  }
  return handleDaemon(cli, voice, status);
}

async function main(): Promise<void> {
  await readStdin(); // drena stdin; el contenido no se usa aquí

  // La caché de la voz activa se escribe siempre, también con la voz
  // desactivada, para que narrate-ctl conozca la de /config.
  const cfg = loadConfig();
  writeActiveVoice(cfg.voice);
  if (!cfg.voiceEnabled) exitSilently();

  // /config solo ofrece las opciones del manifiesto, pero settings.json puede
  // conservar un valor antiguo o editado a mano.
  if (!isSelectableVoice(cfg.voice)) {
    exitWithSystemMessage(
      `EvolutiveX Agents: la voz «${cfg.voice}» de /config no es una de las ` +
        `opciones (${SELECTABLE_VOICES.join(", ")}). Elige una en ` +
        "/config → evolutivex-agents.voice; la narración fallará hasta " +
        "corregirlo y el daemon no se arrancó.",
    );
  }

  const cli = resolveCli();
  if (!cli) {
    exitWithSystemMessage(
      "EvolutiveX Agents: AI Voice-InterConnector no está en el PATH. Instálalo y ejecuta " +
        "ai-voice-interconnector setup para habilitar la narración por voz.",
    );
  }

  // doctor --json imprime el reporte también en el veredicto negativo (exit 1)
  // y en el fallo del comando (doctor_failed); el veredicto sale del exit más
  // el reporte parseado, nunca de un campo status.
  const res = runCli(cli, ["doctor", "--json"], {
    encoding: "utf8",
    timeout: budget(DOCTOR_TIMEOUT_MS),
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
  // aviso de checks de instalación fallidos (si lo hay) viaja con el del
  // daemon o la voz en un único systemMessage.
  const message = [decision.advisory, checkDaemonAndVoice(cli, cfg.voice)]
    .filter(Boolean)
    .join("\n");
  if (message) exitWithSystemMessage(message);
  exitSilently();
}

main().catch(() => process.exit(0));
