// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Validación del valor de configuración `voice`: vive en lib porque la usa la
// configuración y no debe depender del canal de voz.

export const DEFAULT_VOICE = "default";

/** Recorta y pasa a minúsculas, como normaliza el motor. */
export function normalizeVoiceName(raw: string): string {
  return raw.trim().toLowerCase();
}
