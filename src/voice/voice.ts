// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Reglas puras sobre las voces del motor, sin I/O: las
// voces de fábrica, la voz personalizada, la lista de voces que se pueden
// elegir en /config, el nombre de presentación de la voz personalizada, el
// parseo de `voice list --json` y la versión mínima del motor para gestionar
// voces. /config solo ofrece un selector para una lista fija declarada en
// plugin.json (`options`), así que la voz del usuario vive siempre en el motor
// con el nombre fijo `custom`; su nombre propio es solo de presentación.

export const FACTORY_VOICES = ["default", "ryan", "vivian"] as const;
/** Nombre fijo de la voz clonada por el usuario, en el motor y en /config. */
export const CUSTOM_VOICE = "custom";
/** Valores de `voice` en /config; deben coincidir con `options` en plugin.json. */
export const SELECTABLE_VOICES: readonly string[] = [
  ...FACTORY_VOICES,
  CUSTOM_VOICE,
];
export const MIN_ENGINE_VERSION = "0.44.0";

const MAX_DISPLAY_NAME_LENGTH = 64;

/** ¿Es una voz de fábrica del motor (no se clona encima ni se borra)? */
export function isFactoryVoice(name: string): boolean {
  return (FACTORY_VOICES as readonly string[]).includes(name);
}

/** ¿Es uno de los valores que /config permite elegir? */
export function isSelectableVoice(name: string): boolean {
  return SELECTABLE_VOICES.includes(name);
}

/**
 * Normaliza el nombre de presentación de la voz personalizada: recorta y
 * colapsa los espacios. undefined si queda vacío, supera 64 caracteres o
 * contiene caracteres de control.
 */
export function normalizeDisplayName(raw: string): string | undefined {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "" || [...name].length > MAX_DISPLAY_NAME_LENGTH)
    return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return undefined;
  return name;
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
