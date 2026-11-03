// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// ─────────────────────────────────────────────────────────────────────────────
// Transcript enriquecido de EvolutiveX Agents
//
// Añade una marca de tiempo (h:mm:ss a.m. / p.m.) con icono 🕐 dentro de un
// recuadro box-drawing sobre cada render site del transcript: UserMessage,
// AssistantMessage, ToolUse, ToolResult, ToolGroup, CommandOutput,
// AskUserQuestion, Spinner y TurnDuration.
//
// Este módulo solo conecta los hooks: los de ciclo de vida (lifecycle.js)
// fijan hora y duración de cada bloque en el evento que las produce, y los de
// ui.render (render.js) los dibujan.
//
// Activación: opt-in, con `enhancedTranscript` en /config
// (evolutivex-agents.enhancedTranscript, desactivado por defecto).
//
// Protección: cada registro lleva el guard (guard.js) y un `.catch` que cede a
// lo nativo sin volver a ejecutar lo de abajo; tres fallos propios seguidos
// de un mismo handler apagan el transcript en la sesión, con un toast.
//
// Requiere Claude Code v2.1.287 o posterior (function hooks habilitados).
// ─────────────────────────────────────────────────────────────────────────────

import type { On, PluginOptions } from "claude-code";
import {
  onAppend,
  onCommandRun,
  onStep,
  onSubmit,
  onToolCall,
  onTurnComplete,
  onTurnStart,
} from "./lifecycle.js";
import { withSpinner, withTimestamp, withTurnDuration } from "./render.js";
import { guardCall, caught, countTimeout, belowStream } from "./guard.js";

// Claude Code llama a `register` una vez al cargar el plugin, con su
// userConfig en `options`. Sin `enhancedTranscript` activado no registra nada.
export function register(on: On, options: PluginOptions): void {
  if (options.enhancedTranscript !== true) return;

  // Todos los tipos de mensaje en el transcript — tree-wrapping unificado
  for (const component of [
    "UserMessage", // Mensajes del usuario
    "AssistantMessage", // Respuestas de Claude
    "ToolUse", // Llamada a una herramienta
    "ToolResult", // Resultado de una herramienta
    "ToolGroup", // Grupo colapsado de tool calls
    "CommandOutput", // Salida de comando shell
    "AskUserQuestion", // Diálogo de pregunta de Claude
  ] as const) {
    on("ui.render", { component: [component] }, ($, e, next) =>
      guardCall(
        $,
        "withTimestamp",
        () => withTimestamp($, e, next),
        () => next(e),
      ),
    ).catch(($, e, next) => caught($, "withTimestamp", e, next));
  }

  // Status lines del terminal
  on("ui.render", { component: "Spinner" }, ($, e, next) =>
    guardCall(
      $,
      "withSpinner",
      () => withSpinner($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "withSpinner", e, next));
  on("ui.render", { component: "TurnDuration" }, ($, e, next) =>
    guardCall(
      $,
      "withTurnDuration",
      () => withTurnDuration($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "withTurnDuration", e, next));

  // Ciclo de vida: fuente de los tiempos de los footers. turn.step se protege
  // por dentro (onStep) para no perder el chunk en curso.
  on("prompt.submit", ($, e, next) =>
    guardCall(
      $,
      "prompt.submit",
      () => onSubmit($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "prompt.submit", e, next));
  on("turn.start", ($, e, next) =>
    guardCall(
      $,
      "turn.start",
      () => onTurnStart($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "turn.start", e, next));
  on("turn.step", onStep).catch(async function* ($, e, next) {
    countTimeout($, "turn.step", next.error);
    return yield* belowStream(next(e));
  });
  on("tool.call", ($, e, next) =>
    guardCall(
      $,
      "tool.call",
      () => onToolCall($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "tool.call", e, next));
  on("command.run", ($, e, next) =>
    guardCall(
      $,
      "command.run",
      () => onCommandRun($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "command.run", e, next));
  on("session.append", ($, e, next) =>
    guardCall(
      $,
      "session.append",
      () => onAppend($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "session.append", e, next));
  on("turn.complete", ($, e, next) =>
    guardCall(
      $,
      "turn.complete",
      () => onTurnComplete($, e, next),
      () => next(e),
    ),
  ).catch(($, e, next) => caught($, "turn.complete", e, next));
}
