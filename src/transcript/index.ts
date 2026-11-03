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
    on("ui.render", { component: [component] }, withTimestamp);
  }

  // Status lines del terminal
  on("ui.render", { component: "Spinner" }, withSpinner);
  on("ui.render", { component: "TurnDuration" }, withTurnDuration);

  // Ciclo de vida: fuente de los tiempos de los footers
  on("prompt.submit", onSubmit).catch(($, e, next) => next(e));
  on("turn.start", onTurnStart);
  on("turn.step", onStep);
  on("tool.call", onToolCall).catch(($, e, next) => next(e));
  on("command.run", onCommandRun).catch(($, e, next) => next(e));
  on("session.append", onAppend).catch(($, e, next) => next(e));
  on("turn.complete", onTurnComplete);
}
