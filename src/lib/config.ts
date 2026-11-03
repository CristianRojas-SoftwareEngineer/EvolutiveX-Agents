// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Config efectiva de los hooks de comando. Las preferencias viven en el
// `userConfig` del plugin (/config → evolutivex-agents.*): Claude Code las
// entrega a cada hook como variables CLAUDE_PLUGIN_OPTION_<CLAVE> (la clave en
// mayúsculas, booleanos como "true"/"false"), pero solo las que el usuario
// fijó; los valores por defecto se aplican aquí. La API key se lee únicamente
// de la variable de entorno GEMINI_API_KEY y nunca se persiste en disco. La
// voz activa se normaliza pero no se valida: un valor fuera de las opciones de
// /config (p. ej. uno antiguo que quedó en settings.json) se conserva para que
// SessionStart lo avise, en lugar de narrar con otra voz en silencio.
import { DEFAULT_VOICE, normalizeVoiceName } from "../voice/voice.js";

export type MessageMode = "llm" | "local";

export interface Config {
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
  messageMode: MessageMode;
  /** Voz activa del motor, normalizada; `default` si no está fijada. */
  voice: string;
  /** Campo de tiempo de ejecución: proviene solo de GEMINI_API_KEY. */
  geminiApiKey?: string;
}

// Deben coincidir con los `default` de userConfig en .claude-plugin/plugin.json.
const DEFAULTS: Config = {
  voiceEnabled: true,
  notificationsEnabled: true,
  messageMode: "local",
  voice: DEFAULT_VOICE,
};

/**
 * Config efectiva: los defaults, sobrescritos por las opciones que el usuario
 * fijó en /config. Un valor ausente o inválido cuenta como no fijado, salvo la
 * voz, que solo cae a `default` si falta o queda vacía. Nunca lanza.
 */
export function loadConfig(): Config {
  const env = process.env;
  const mode = env.CLAUDE_PLUGIN_OPTION_MESSAGEMODE;
  return {
    voiceEnabled: parseBoolean(
      env.CLAUDE_PLUGIN_OPTION_VOICEENABLED,
      DEFAULTS.voiceEnabled,
    ),
    notificationsEnabled: parseBoolean(
      env.CLAUDE_PLUGIN_OPTION_NOTIFICATIONSENABLED,
      DEFAULTS.notificationsEnabled,
    ),
    messageMode:
      mode === "llm" || mode === "local" ? mode : DEFAULTS.messageMode,
    voice:
      normalizeVoiceName(env.CLAUDE_PLUGIN_OPTION_VOICE ?? "") ||
      DEFAULTS.voice,
    geminiApiKey: emptyToUndef(env.GEMINI_API_KEY),
  };
}

function parseBoolean(v: string | undefined, fallback: boolean): boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function emptyToUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
