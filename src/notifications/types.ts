// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Tipos del servicio de notificaciones de escritorio.

/**
 * Payload de notificación que el adaptador concreto recibe y traduce a un toast del SO.
 * Forma mínima: además de los campos base (`title`, `message`, `sound?`,
 * `silent?`), admite dos campos opcionales de branding (`appId?`, `icon?`).
 * El contrato del puerto no expone otros campos de personalización
 * (`image`, `contentImage`, `appIdPath`, `subtitle`, `category`,
 * `urgency`, `timeout`, `wait`, `open`, `closeLabel`, `actions`,
 * `heroImage`) en v1.
 */
export interface NotificationPayload {
  title: string;
  message: string;
  /** `boolean` (Linux / flag CLI) o token/nombre del SO (`string` en Windows/macOS). */
  sound?: boolean | string;
  silent?: boolean;
  /** Identificador de aplicación (AUMID en Windows). Inyectado por la CLI. */
  appId?: string;
  /** Ruta a un asset de imagen usado como icono cosmético del toast. */
  icon?: string;
}
