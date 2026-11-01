// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Catálogo de perfiles por evento: copy, imagen de cuerpo y sonido por plataforma.

export const NOTIFICATION_BRAND_TITLE = "Agent-VoiceInterConnector";

export type SoundSemanticLevel =
  "neutral" | "message" | "activity" | "attention" | "alarm";

export interface NotificationSoundProfile {
  win32?: string | false;
  darwin?: string | false;
  linux?: boolean;
}

export interface EventNotificationProfile {
  message: string;
  image: string;
  level: SoundSemanticLevel;
  sound: NotificationSoundProfile;
}

export const EVENT_NOTIFICATION_PROFILES: Record<
  string,
  EventNotificationProfile
> = {
  UserPromptSubmit: {
    message: "Procesando tu solicitud...",
    image: "user-prompt-submit.png",
    level: "message",
    sound: { win32: "Reminder", darwin: "Submarine", linux: true },
  },
  PreToolUse: {
    message: "Pregunta pendiente — Responde en la ventana del cliente.",
    image: "pre-tool-use-ask.png",
    level: "attention",
    sound: { win32: "SMS", darwin: "Hero", linux: true },
  },
  SubagentStart: {
    message: "Subagente iniciado",
    image: "subagent-start.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true },
  },
  SubagentStop: {
    message: "Subagente terminado",
    image: "subagent-stop.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true },
  },
  Stop: {
    message: "Tu turno — El asistente terminó. Escribe tu siguiente mensaje.",
    image: "stop.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true },
  },
  StopFailure: {
    message: "Error de API — No se completó la respuesta.",
    image: "stop-failure.png",
    level: "alarm",
    sound: { win32: "LoopingAlarm7", darwin: "Basso", linux: true },
  },
  SessionStart: {
    message: "Sesión iniciada",
    image: "session-start.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true },
  },
  SessionEnd: {
    message: "Sesión finalizada",
    image: "session-end.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true },
  },
  PermissionRequest: {
    message: "Permiso requerido — Confirma la herramienta en el cliente.",
    image: "permission-request.png",
    level: "attention",
    sound: { win32: "SMS", darwin: "Hero", linux: true },
  },
  TaskCreated: {
    message: "Tarea creada",
    image: "task-created.png",
    level: "message",
    sound: { win32: "Reminder", darwin: "Submarine", linux: true },
  },
  TaskCompleted: {
    message: "Tarea completada",
    image: "task-completed.png",
    level: "neutral",
    sound: { win32: "Default", darwin: "Tink", linux: true },
  },
  TaskInProgress: {
    message: "Tarea iniciada",
    image: "task-in-progress.png",
    level: "activity",
    sound: { win32: "IM", darwin: "Ping", linux: true },
  },
};

export const NOTIFICATION_EVENT_KEYS = Object.keys(EVENT_NOTIFICATION_PROFILES);

export function getProfileForEvent(
  eventKey: string,
): EventNotificationProfile | undefined {
  return EVENT_NOTIFICATION_PROFILES[eventKey];
}
