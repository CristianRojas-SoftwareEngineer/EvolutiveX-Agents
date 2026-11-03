// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Suite completa del canal de notificaciones de escritorio del plugin:
// adaptador node-notifier, catálogo de perfiles, sonidos por SO, rutas de
// imágenes, formatters de payload, CLI, MS-SHLLINK (.lnk), registro Windows,
// helper de registro AUMID e independencia entre canales de voz y escritorio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DesktopNotificationAdapter,
  type NodeNotifierOptions,
} from "../src/notifications/desktop-notification-adapter.js";
import {
  EVENT_NOTIFICATION_PROFILES,
  NOTIFICATION_BRAND_TITLE,
  NOTIFICATION_EVENT_KEYS,
  getProfileForEvent,
} from "../src/notifications/event-notification-profile.js";
import { resolveNotificationSound } from "../src/notifications/resolve-notification-sound.js";
import {
  eventIconsDirProvider,
  resolveEventImagePath,
} from "../src/notifications/event-image-paths.js";
import {
  formatPermissionRequestMessage,
  formatPreToolUseAskMessage,
  formatStopFailureMessage,
  formatStopMessage,
  formatTaskInProgressMessage,
  formatUserPromptSubmitMessage,
  repairMojibake,
  resolveHookNotificationMessage,
} from "../src/notifications/hook-payload-notification-message.js";
import {
  DEFAULT_APP_ID,
  buildNotificationPayload,
  globalFallbackIconProvider,
  normalizeStdinJsonText,
  resolveBranding,
  resolveEventKey,
  resolveEventSound,
  resolveNotificationMessage,
  resolveNotificationTitle,
  type CliOptions,
} from "../src/notifications/cli.js";
import {
  parseIconLocation,
  patchIconLocation,
} from "../src/notifications/lnk-format.js";
import {
  deleteRegistry,
  readRegistry,
  regExecProvider,
  writeRegistry,
} from "../src/notifications/registry.js";
import {
  AUMID,
  DISPLAY_NAME,
  dispatch,
  getIconIcoPath,
  getIconPngPath,
  getLnkPath,
  installAction,
  registryProvider,
  snoreToastProvider,
  statusAction,
  uninstallAction,
} from "../src/notifications/register.js";
import {
  notificationEventKey,
  runNotificationHookFromRaw,
} from "../src/notifications/notification-hook.js";
import { updateConfig } from "../src/lib/config.js";
import { isolateStateDir, makeTempDir, removeDir } from "./helpers.js";

const baseCliOptions: CliOptions = {
  eventType: "Stop",
  message: "Test",
  title: undefined,
  sound: false,
  silent: false,
  stdinJson: false,
  appId: undefined,
  icon: undefined,
};

// --- DesktopNotificationAdapter ---

test("DesktopNotificationAdapter: traduce appId→appID, silent→sound:false y propaga errores", async () => {
  const calls: NodeNotifierOptions[] = [];
  const adapter = new DesktopNotificationAdapter((opts, cb) => {
    calls.push(opts);
    cb(null);
  });

  await adapter.notify({ title: "Hola", message: "Mundo" });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]!).sort(), [
    "message",
    "sound",
    "title",
    "wait",
  ]);
  assert.equal(calls[0]!.sound, false);
  assert.equal(calls[0]!.wait, false);

  await adapter.notify({
    title: "Hola",
    message: "Mundo",
    sound: "Notification.SMS",
    appId: "EvolutiveX.Agents",
    icon: "/ruta/icon.png",
  });
  assert.equal(calls[1]!.appID, "EvolutiveX.Agents");
  assert.equal(calls[1]!.icon, "/ruta/icon.png");
  assert.equal(calls[1]!.sound, "Notification.SMS");

  await adapter.notify({
    title: "Hola",
    message: "Mundo",
    sound: true,
    silent: true,
  });
  assert.equal(calls[2]!.sound, false);

  const failing = new DesktopNotificationAdapter((_opts, cb) => {
    cb(new Error("boom"));
  });
  await assert.rejects(
    () => failing.notify({ title: "x", message: "y" }),
    /boom/,
  );
});

// --- Catálogo de perfiles, sonidos e imágenes ---

test("event-notification-profile y assets: 12 eventos con imágenes existentes en el plugin", () => {
  assert.equal(NOTIFICATION_BRAND_TITLE, "EvolutiveX Agents");
  assert.equal(NOTIFICATION_EVENT_KEYS.length, 12);
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const profile = getProfileForEvent(key);
    assert.ok(profile, `Falta perfil para ${key}`);
    assert.equal(EVENT_NOTIFICATION_PROFILES[key]?.sound.linux, true);
    const imgPath = resolveEventImagePath(profile.image);
    assert.ok(imgPath && existsSync(imgPath), `Falta imagen para ${key}`);
  }
  assert.ok(existsSync(getIconIcoPath()));
  assert.ok(existsSync(getIconPngPath()));
  assert.equal(getProfileForEvent("PostToolUse"), undefined);
});

test("resolveNotificationSound: traduce tokens por plataforma", () => {
  assert.equal(
    resolveNotificationSound(getProfileForEvent("StopFailure")?.sound, "win32"),
    "Notification.Looping.Alarm7",
  );
  assert.equal(
    resolveNotificationSound(getProfileForEvent("PreToolUse")?.sound, "win32"),
    "Notification.SMS",
  );
  assert.equal(
    resolveNotificationSound(
      getProfileForEvent("SubagentStart")?.sound,
      "darwin",
    ),
    "Ping",
  );
  assert.equal(
    resolveNotificationSound(
      getProfileForEvent("PermissionRequest")?.sound,
      "linux",
    ),
    true,
  );
  assert.equal(resolveNotificationSound(undefined, "win32"), false);
});

test("resolveEventImagePath: respeta eventIconsDirProvider y devuelve undefined si falta", () => {
  const tmp = makeTempDir("event-img-");
  const prev = eventIconsDirProvider.get;
  try {
    const p = join(tmp, "stop.png");
    writeFileSync(p, "data");
    eventIconsDirProvider.get = () => tmp;
    assert.equal(resolveEventImagePath("stop.png"), p);
    assert.equal(resolveEventImagePath("missing.png"), undefined);
  } finally {
    eventIconsDirProvider.get = prev;
    removeDir(tmp);
  }
});

// --- Formatters de payload y mojibake ---

test("hook-payload-notification-message: formatea eventos, repara mojibake y trunca", () => {
  assert.match(
    formatStopFailureMessage({
      error: "rate_limit",
      last_assistant_message: "Voy a ejecutar los tests",
    }),
    /Límite de tasa \(API\)[\s\S]*Voy a ejecutar los tests/,
  );
  assert.match(
    formatStopFailureMessage({ error: "custom_code" }),
    /custom_code/,
  );
  assert.equal(
    formatPermissionRequestMessage({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }),
    "Permiso para: Bash\nnpm test",
  );
  assert.equal(
    formatPermissionRequestMessage({ tool_name: "Read" }),
    "Permiso para: Read",
  );
  assert.match(
    formatPreToolUseAskMessage({
      tool_input: {
        questions: [{ question: "¿Usamos Redis?" }, { header: "Otro" }],
      },
    }) ?? "",
    /2 preguntas pendientes\n¿Usamos Redis\?/,
  );
  assert.equal(formatPreToolUseAskMessage({ tool_input: {} }), null);
  assert.equal(
    formatUserPromptSubmitMessage({
      prompt: "Prueba: sesión, configuración, acción, niño",
    }),
    "Prueba: sesión, configuración, acción, niño",
  );
  assert.equal(formatUserPromptSubmitMessage({}), null);
  assert.equal(
    formatStopMessage({ last_assistant_message: "Listo el refactor" }),
    "Listo el refactor",
  );
  assert.equal(formatStopMessage({}), null);
  assert.equal(resolveHookNotificationMessage("SessionStart", {}), null);
  assert.equal(repairMojibake("Hola, Â¿quÃ© hace?"), "Hola, ¿qué hace?");
  assert.equal(
    resolveHookNotificationMessage("UserPromptSubmit", {
      prompt: "Hola, Â¿quÃ© hace?",
    }),
    "Hola, ¿qué hace?",
  );
  assert.equal(
    resolveHookNotificationMessage("TaskInProgress", {
      tool_input: { subject: "ConfiguraciÃ³n regional", status: "in_progress" },
    }),
    "Tarea iniciada: Configuración regional",
  );
  assert.equal(
    resolveHookNotificationMessage("TaskCreated", {
      task_subject: "Ejecutar pruebas",
    }),
    "Tarea creada: Ejecutar pruebas",
  );
  assert.equal(
    resolveHookNotificationMessage("TaskCompleted", {
      task_subject: "Ejecutar pruebas",
    }),
    "Tarea completada: Ejecutar pruebas",
  );
  const longMsg = formatTaskInProgressMessage({
    tool_input: { subject: "A".repeat(200) },
  });
  assert.ok(longMsg && longMsg.endsWith("…"));
});

// --- CLI de notificaciones ---

test("CLI: branding EvolutiveX.Agents, precedencias, overrides y degradación de icono", () => {
  assert.deepEqual(
    JSON.parse(normalizeStdinJsonText('\uFEFF{"hook_event_name":"Stop"}\n')),
    { hook_event_name: "Stop" },
  );
  const branding = resolveBranding(baseCliOptions, "Stop");
  assert.equal(branding.appId, DEFAULT_APP_ID);
  assert.match(branding.icon ?? "", /stop\.png$/);

  assert.equal(
    resolveBranding({ ...baseCliOptions, appId: "Custom.Id" }).appId,
    "Custom.Id",
  );
  assert.equal(
    resolveBranding({ ...baseCliOptions, icon: "/tmp/custom.png" }).icon,
    "/tmp/custom.png",
  );
  assert.equal(
    resolveEventSound(
      { ...baseCliOptions, silent: true },
      "StopFailure",
      "win32",
    ),
    false,
  );
  assert.equal(
    resolveEventSound(
      { ...baseCliOptions, sound: true },
      "StopFailure",
      "win32",
    ),
    true,
  );
  assert.equal(
    resolveEventKey(
      { ...baseCliOptions, eventType: "Stop" },
      { hook_event_name: "Other" },
    ),
    "Stop",
  );
  assert.equal(
    resolveNotificationTitle(baseCliOptions, undefined),
    NOTIFICATION_BRAND_TITLE,
  );
  assert.equal(
    resolveNotificationTitle({ ...baseCliOptions, title: "Custom" }, "Stop"),
    "Custom",
  );
  assert.equal(
    resolveNotificationMessage(
      { ...baseCliOptions, stdinJson: true, message: "Override" },
      "StopFailure",
      { error: "rate_limit" },
    ),
    "Override",
  );

  const errNoEvent = buildNotificationPayload({
    ...baseCliOptions,
    eventType: undefined,
  });
  assert.ok("error" in errNoEvent);

  const errNoStdin = buildNotificationPayload({
    ...baseCliOptions,
    stdinJson: true,
    eventType: undefined,
    message: undefined,
  });
  assert.ok("error" in errNoStdin);

  // Degradación cuando ni la imagen del evento ni el fallback global existen
  const prevEvents = eventIconsDirProvider.get;
  const prevGlobal = globalFallbackIconProvider.get;
  try {
    eventIconsDirProvider.get = () => "/no/existe/events";
    globalFallbackIconProvider.get = () => "/no/existe/ai-assistant.png";
    const built = buildNotificationPayload(baseCliOptions, undefined, "win32");
    assert.ok(!("error" in built));
    assert.equal(built.appId, "EvolutiveX.Agents");
    assert.equal(built.icon, undefined);
  } finally {
    eventIconsDirProvider.get = prevEvents;
    globalFallbackIconProvider.get = prevGlobal;
  }
});

// --- Formato MS-SHLLINK (.lnk) ---

/**
 * Construye un buffer `.lnk` Unicode sintético mínimo (76 bytes de cabecera +
 * `IconLocation` opcional + terminador de 4 bytes) para ejercitar `parseIconLocation`
 * y `patchIconLocation` sin depender de ejecutables de Windows.
 */
function buildTestLnkBytes(iconLocation?: string): Buffer {
  const header = Buffer.alloc(0x4c);
  header.writeUInt32LE(0x4c, 0x00);
  Buffer.from([
    0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x46,
  ]).copy(header, 0x04);
  // IsUnicode (0x80) y opcionalmente HasIconLocation (0x40)
  header.writeUInt32LE(iconLocation ? 0x80 | 0x40 : 0x80, 0x14);
  const terminator = Buffer.from([0, 0, 0, 0]);
  const base = Buffer.concat([header, terminator]);
  return iconLocation ? patchIconLocation(base, iconLocation) : base;
}

test("lnk-format: inserción, reemplazo y lectura de IconLocation", () => {
  const withoutIcon = buildTestLnkBytes();
  assert.equal(withoutIcon.readUInt32LE(0), 0x4c);
  assert.equal(parseIconLocation(withoutIcon), undefined);

  const inserted = patchIconLocation(
    withoutIcon,
    "C:\\repo\\assets\\notifications\\ai-assistant.ico,0",
  );
  assert.equal(
    parseIconLocation(inserted),
    "C:\\repo\\assets\\notifications\\ai-assistant.ico,0",
  );

  const replaced = patchIconLocation(inserted, "C:\\nuevo\\ai-assistant.ico,1");
  assert.equal(parseIconLocation(replaced), "C:\\nuevo\\ai-assistant.ico,1");
  assert.equal(parseIconLocation(Buffer.alloc(20)), undefined);
});

// --- Registro Windows y helper register.ts (con proveedores simulados) ---

test("registry: readRegistry, writeRegistry y deleteRegistry usan reg.exe", async () => {
  const prevExec = regExecProvider.execFile;
  const calls: Array<{ cmd: string; args: string[] }> = [];
  try {
    regExecProvider.execFile = (cmd, args, _opts, cb) => {
      calls.push({ cmd, args });
      if (args[0] === "query") {
        cb(
          null,
          [
            `HKEY_CURRENT_USER\\Software\\Classes\\AppUserModelId\\${AUMID}`,
            `    DisplayName    REG_SZ    ${DISPLAY_NAME}`,
            "    Icon           REG_EXPAND_SZ    C:\\icon.ico",
            "    IconUri        REG_SZ    C:\\icon.png",
            "    ShortcutEngine REG_SZ    snoretoast",
            "",
          ].join("\r\n"),
          "",
        );
        return;
      }
      cb(null, "", "");
    };

    const state = await readRegistry(AUMID);
    assert.equal(state.exists, true);
    assert.equal(state.displayName, DISPLAY_NAME);
    assert.equal(state.shortcutEngine, "snoretoast");

    await writeRegistry(AUMID, DISPLAY_NAME, "C:\\icon.ico", "C:\\icon.png");
    await deleteRegistry(AUMID);
    assert.equal(calls.length, 8);

    regExecProvider.execFile = (_cmd, _args, _opts, cb) => {
      cb(Object.assign(new Error("not found"), { code: 1 }), "", "");
    };
    assert.deepEqual(await readRegistry(AUMID), { exists: false });
    await assert.doesNotReject(() => deleteRegistry(AUMID));
  } finally {
    regExecProvider.execFile = prevExec;
  }
});

test("register: installAction, statusAction, uninstallAction y dispatch multiplataforma", async () => {
  const tmpAppData = makeTempDir("register-test-");
  const prevAppData = process.env.APPDATA;
  const prevReg = { ...registryProvider };
  const prevSnore = { ...snoreToastProvider };
  try {
    process.env.APPDATA = tmpAppData;
    const lnkPath = getLnkPath();
    mkdirSync(dirname(lnkPath), { recursive: true });

    let regWrites = 0;
    let snoreInstalls = 0;
    registryProvider.readRegistry = async () => ({ exists: false });
    registryProvider.writeRegistry = async () => {
      regWrites++;
    };
    registryProvider.deleteRegistry = async () => {};
    snoreToastProvider.getSnoreToastPath = () => "C:\\fake\\snoretoast-x64.exe";
    snoreToastProvider.installSnoreToastShortcut = async (
      _name,
      _target,
      _aumid,
      dest,
      iconLoc,
    ) => {
      snoreInstalls++;
      writeFileSync(dest, buildTestLnkBytes(iconLoc));
    };

    assert.equal(await installAction(), 0);
    assert.equal(regWrites, 1);
    assert.equal(snoreInstalls, 1);
    assert.equal(existsSync(lnkPath), true);

    // Ahora simulamos estado ya registrado: debe ser idempotente
    registryProvider.readRegistry = async () => ({
      exists: true,
      displayName: DISPLAY_NAME,
      icon: getIconIcoPath(),
      iconUri: getIconPngPath(),
      shortcutEngine: "snoretoast",
    });
    assert.equal(await installAction(), 0);
    assert.equal(regWrites, 1);
    assert.equal(snoreInstalls, 1);
    assert.equal(await statusAction(), 0);

    assert.equal(await uninstallAction(), 0);
    assert.equal(existsSync(lnkPath), false);
    assert.equal(await dispatch({ install: true }, "linux"), 0);
  } finally {
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    Object.assign(registryProvider, prevReg);
    Object.assign(snoreToastProvider, prevSnore);
    removeDir(tmpAppData);
  }
});

// --- Independencia entre canales y filtros de notification-hook ---

test("notification-hook: filtra eventos y funciona con voz desactivada sin bloquear", async () => {
  const state = isolateStateDir();
  try {
    assert.equal(
      notificationEventKey({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
      }),
      undefined,
    );
    assert.equal(
      notificationEventKey({
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
      }),
      "PreToolUse",
    );
    assert.equal(
      notificationEventKey({
        hook_event_name: "PostToolUse",
        tool_name: "TaskUpdate",
        tool_input: { status: "in_progress" },
      }),
      "TaskInProgress",
    );
    assert.equal(
      notificationEventKey({
        hook_event_name: "PostToolUse",
        tool_name: "TaskUpdate",
        tool_input: { status: "completed" },
      }),
      undefined,
    );

    // Con voz desactivada (voiceEnabled: false) y notificaciones activas (notificationsEnabled: true)
    updateConfig({ voiceEnabled: false, notificationsEnabled: true });
    const received: unknown[] = [];
    const adapter = {
      notify(ev: unknown) {
        received.push(ev);
      },
    };

    const emitted = await runNotificationHookFromRaw(
      JSON.stringify({
        hook_event_name: "Stop",
        last_assistant_message: "Respuesta lista",
      }),
      adapter,
    );
    assert.equal(emitted, true);
    assert.equal(received.length, 1);

    // PreToolUse AskUserQuestion sin questions no emite toast
    const skippedAsk = await runNotificationHookFromRaw(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { questions: [] },
      }),
      adapter,
    );
    assert.equal(skippedAsk, false);

    // Si notificationsEnabled se apaga, no emite aunque voz esté encendida
    updateConfig({ voiceEnabled: true, notificationsEnabled: false });
    const blocked = await runNotificationHookFromRaw(
      JSON.stringify({
        hook_event_name: "Stop",
        last_assistant_message: "No debe salir",
      }),
      adapter,
    );
    assert.equal(blocked, false);
    assert.equal(received.length, 1);
  } finally {
    state.restore();
  }
});
