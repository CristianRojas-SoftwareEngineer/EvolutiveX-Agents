// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Lee y escribe config.json en el state dir. El archivo solo guarda preferencias
// no secretas (voiceEnabled, notificationsEnabled y messageMode). La API key se lee
// únicamente de la variable de entorno GEMINI_API_KEY y nunca se persiste en disco.
import { readFileSync, writeFileSync } from "node:fs";
import { configPath, ensureStateDir } from "./state-dir.js";

export type MessageMode = "llm" | "local";

export interface Config {
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
  messageMode: MessageMode;
  /** Campo de tiempo de ejecución: proviene solo de GEMINI_API_KEY. */
  geminiApiKey?: string;
}

interface FileConfig {
  voiceEnabled?: boolean;
  notificationsEnabled?: boolean;
  messageMode?: MessageMode;
}

const DEFAULTS: Config = {
  voiceEnabled: true,
  notificationsEnabled: true,
  messageMode: "local",
};

function readFileConfig(): FileConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      // Solo se conservan preferencias no secretas; cualquier campo de clave
      // presente en un archivo se ignora.
      const { voiceEnabled, notificationsEnabled, messageMode } =
        parsed as FileConfig;
      return { voiceEnabled, notificationsEnabled, messageMode };
    }
  } catch {
    // Sin archivo o JSON inválido: se usan defaults.
  }
  return {};
}

/**
 * Config efectiva: defaults ← archivo ← variable de entorno (mayor precedencia).
 * Nunca lanza; ante cualquier problema devuelve al menos los defaults.
 * La API key solo se lee del entorno; nunca del archivo.
 */
export function loadConfig(): Config {
  const file = readFileConfig();
  return {
    voiceEnabled:
      typeof file.voiceEnabled === "boolean"
        ? file.voiceEnabled
        : DEFAULTS.voiceEnabled,
    notificationsEnabled:
      typeof file.notificationsEnabled === "boolean"
        ? file.notificationsEnabled
        : DEFAULTS.notificationsEnabled,
    messageMode: file.messageMode === "llm" ? "llm" : DEFAULTS.messageMode,
    geminiApiKey: emptyToUndef(process.env.GEMINI_API_KEY),
  };
}

/**
 * Persiste preferencias no secretas sobre la config del archivo con permisos
 * restrictivos (0600 en POSIX; no-op efectivo en Windows). Nunca escribe
 * campos de clave. Usado por la skill.
 */
export function updateConfig(
  patch: Partial<
    Pick<Config, "voiceEnabled" | "notificationsEnabled" | "messageMode">
  >,
): Config {
  ensureStateDir();
  const current = readFileConfig();
  const next = {
    voiceEnabled:
      patch.voiceEnabled ??
      (typeof current.voiceEnabled === "boolean"
        ? current.voiceEnabled
        : DEFAULTS.voiceEnabled),
    notificationsEnabled:
      patch.notificationsEnabled ??
      (typeof current.notificationsEnabled === "boolean"
        ? current.notificationsEnabled
        : DEFAULTS.notificationsEnabled),
    messageMode:
      patch.messageMode ??
      (current.messageMode === "llm" ? "llm" : DEFAULTS.messageMode),
  };
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  return loadConfig();
}

function emptyToUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
