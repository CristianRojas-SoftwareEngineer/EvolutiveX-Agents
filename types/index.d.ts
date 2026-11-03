// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Contrato de estado del transcript enriquecido: `second` es el reloj de
// sesión que avanza los contadores en vivo (epoch ms del último tick).
declare module "claude-code" {
  interface PluginState {
    "evolutivex-agents": { second: number };
  }
}
