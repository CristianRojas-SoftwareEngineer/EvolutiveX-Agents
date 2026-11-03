// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Registro único de los anuncios estáticos pre-sintetizados: texto canónico y
// label semántico fijo. El worker reproduce por label con `speech play`,
// `narrate-ctl presynth` sintetiza por label con `speech synthesize` y el
// builder decide qué eventos lo usan — todos desde este catálogo. El label es un
// slug estable asignado por anuncio, no derivado del texto: cambiar una frase no
// cambia su label, así que el re-sync tras un cambio se hace a mano con
// `presynth --force`. Convención de texto: toda frase termina en punto, para una
// entonación final consistente al sintetizar.

/** Anuncio estático: texto canónico y label semántico fijo. */
export interface Announcement {
  text: string;
  label: string;
}

/**
 * Petición de narración que el builder entrega al worker: reproducir un anuncio
 * pre-sintetizado (`speech play`, sin modelo ni daemon) o sintetizar un texto
 * dinámico (`speech say`, exige daemon).
 */
export type NarrationRequest =
  { kind: "play"; label: string } | { kind: "say"; text: string };

function announcement(text: string, label: string): Announcement {
  return { text, label };
}

/**
 * Catálogo de los seis anuncios pre-sintetizados: el acuse fijo de
 * `UserPromptSubmit` y los fallbacks estáticos de último recurso por evento
 * (más el default para eventos desconocidos).
 */
export const ANNOUNCEMENTS = {
  UserPromptSubmit: announcement(
    "Procesando con Claude.",
    "voice-user-prompt-submit",
  ),
  Stop: announcement("El asistente terminó su turno.", "voice-stop"),
  SubagentStop: announcement(
    "El subagente completó su trabajo.",
    "voice-subagent-stop",
  ),
  StopFailure: announcement(
    "Ocurrió un error durante la ejecución.",
    "voice-stop-failure",
  ),
  Notification: announcement(
    "Claude necesita tu atención.",
    "voice-notification",
  ),
  Default: announcement("Notificación de Claude.", "voice-default"),
} as const satisfies Record<string, Announcement>;
