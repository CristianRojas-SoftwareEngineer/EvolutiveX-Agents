// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resuelve la raíz del plugin tanto al ejecutarse desde `dist/*.js` como
 * desde `src/notifications/*.ts` o `tests/.build/*.js`.
 */
export function resolvePluginRoot(metaUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(metaUrl));
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "assets", "notifications"))) {
      return dir;
    }
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolvePath(dirname(fileURLToPath(metaUrl)), "..");
}

/** Permite sustituir el directorio repo en tests (ESM no intercepta llamadas internas a exports). */
export const repoEventsDirProvider = {
  get(): string {
    return join(resolvePluginRoot(), "assets", "notifications", "events");
  },
};

export function getRepoEventsDir(): string {
  return repoEventsDirProvider.get();
}

export function resolveEventImagePath(filename: string): string | undefined {
  const repoPath = join(getRepoEventsDir(), filename);
  return existsSync(repoPath) ? repoPath : undefined;
}
