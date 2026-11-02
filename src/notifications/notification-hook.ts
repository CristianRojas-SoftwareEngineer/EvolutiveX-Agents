// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Hook de notificaciones de escritorio del plugin. Independiente del canal de
// narración por voz, del daemon y del gateway. Emite toasts silenciosos por
// defecto usando el icono específico del evento y el AUMID EvolutiveX.Agent.
import { loadConfig } from "../lib/config.js";
import { readStdin } from "../lib/hook-payload.js";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import { DesktopNotificationAdapter } from "./desktop-notification-adapter.js";
import type { NotificationService } from "./notification-service.js";
import { buildNotificationPayload, normalizeStdinJsonText } from "./cli.js";

const DIRECT_NOTIFICATION_EVENTS = new Set([
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionStart",
  "SessionEnd",
  "PermissionRequest",
  "TaskCreated",
  "TaskCompleted",
]);

export function notificationEventKey(
  payload: Record<string, unknown>,
): string | undefined {
  const event = payload.hook_event_name;
  if (event === "PreToolUse") {
    return payload.tool_name === "AskUserQuestion" ? event : undefined;
  }
  if (event === "PostToolUse") {
    const input = payload.tool_input;
    return payload.tool_name === "TaskUpdate" &&
      input !== null &&
      typeof input === "object" &&
      (input as Record<string, unknown>).status === "in_progress"
      ? "TaskInProgress"
      : undefined;
  }
  return typeof event === "string" && DIRECT_NOTIFICATION_EVENTS.has(event)
    ? event
    : undefined;
}

export async function runNotificationHookFromRaw(
  raw: string,
  adapter: NotificationService = new DesktopNotificationAdapter(),
): Promise<boolean> {
  if (!loadConfig().notificationsEnabled) return false;
  const normalized = normalizeStdinJsonText(raw);
  if (!normalized) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const payload = parsed as Record<string, unknown>;
  const event = notificationEventKey(payload);
  if (!event) return false;
  // Para PreToolUse (AskUserQuestion) exigimos que el formatter produzca texto
  // (es decir, que tool_input.questions no esté vacío).
  if (event === "PreToolUse") {
    const ti = payload.tool_input;
    const questions =
      ti != null && typeof ti === "object"
        ? (ti as { questions?: unknown[] }).questions
        : undefined;
    if (!Array.isArray(questions) || questions.length === 0) {
      return false;
    }
  }
  const built = buildNotificationPayload(
    {
      eventType: event,
      sound: false,
      silent: true,
      stdinJson: true,
    },
    payload,
  );
  if ("error" in built) return false;
  await adapter.notify(built);
  return true;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  await runNotificationHookFromRaw(raw);
}

if (
  process.argv[1] &&
  ["notification-hook.js", "notification-hook.ts"].includes(
    basename(process.argv[1]),
  ) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
