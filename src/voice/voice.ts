// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Reglas puras sobre las voces del motor, sin I/O: la voz por defecto, las
// voces de fábrica, la plausibilidad de un nombre, el parseo de
// `voice list --json` y la versión mínima del motor para gestionar voces. Las
// comparten la configuración, el health-check y narrate-ctl. El motor sigue
// siendo la autoridad sobre los nombres: la plausibilidad solo decide avisos y
// mensajes del plugin.

export const DEFAULT_VOICE = "default";
export const FACTORY_VOICES = ["default", "ryan", "vivian"] as const;
export const MIN_ENGINE_VERSION = "0.42.0";

const MAX_VOICE_NAME_LENGTH = 64;

/** Recorta y pasa a minúsculas, como normaliza el motor. */
export function normalizeVoiceName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * ¿El nombre parece válido para el motor? Letras y números ASCII, punto, guion
 * y guion bajo, hasta 64 caracteres y sin `..`.
 */
export function isPlausibleVoiceName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_VOICE_NAME_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    !name.includes("..")
  );
}

/** ¿Es una voz de fábrica del motor (no se clona encima ni se borra)? */
export function isFactoryVoice(name: string): boolean {
  return (FACTORY_VOICES as readonly string[]).includes(name);
}

/**
 * Parsea la salida de `voice list --json`: `{"voices": string[]}`, tolerando
 * claves adicionales. Cualquier otra forma devuelve undefined.
 */
export function parseVoiceList(stdout: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  const voices = (parsed as Record<string, unknown>).voices;
  if (!Array.isArray(voices) || !voices.every((v) => typeof v === "string"))
    return undefined;
  return voices as string[];
}

/**
 * ¿La versión `major.minor.patch` del motor es igual o posterior a
 * MIN_ENGINE_VERSION? Compara numéricamente; una versión ilegible devuelve
 * false. Un sufijo de pre-release o build tras el patch se ignora.
 */
export function meetsMinVersion(version: string): boolean {
  const actual = parseVersion(version);
  const min = parseVersion(MIN_ENGINE_VERSION);
  if (!actual || !min) return false;
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== min[i]) return actual[i] > min[i];
  }
  return true;
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
