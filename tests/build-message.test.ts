// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Caracterización de buildMessage: enrutado MVP determinista. Solo `Stop` (y el
// default) genera locución dinámica sobre `last_assistant_message`; el resto de
// eventos reproduce su anuncio pre-sintetizado (`play`). La degradación local
// narra hasta `LOCAL_SPEECH_MAX_SENTENCES` oraciones del texto saneado, y el
// saneo descarta el cuerpo de los bloques de código cercados: una respuesta que
// solo sea código degrada al anuncio estático. Blinda el invariante «el LLM nunca
// recibe nada que no sea last_assistant_message» y el caso «Hola».
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMessage } from "../src/message/build-message.js";
import { ANNOUNCEMENTS } from "../src/message/static-announcements.js";
import { SUMMARY_CLOSING } from "../src/message/prompts.js";
import { withEnv } from "./helpers.js";
import type { Config } from "../src/lib/config.js";
import type { HookPayload } from "../src/lib/hook-payload.js";

const LOCAL: Config = {
  enabled: true,
  desktopEnabled: false,
  messageMode: "local",
  geminiApiKey: undefined,
};

const LLM: Config = {
  enabled: true,
  desktopEnabled: false,
  messageMode: "llm",
  geminiApiKey: "dummy",
};

// --- Enrutado de eventos con anuncio fijo (`play`), sin LLM ---

test("UserPromptSubmit es un acuse fijo: play del anuncio pre-sintetizado, ignora el prompt", async () => {
  const out = await buildMessage(
    { hook_event_name: "UserPromptSubmit", prompt: "haz X" },
    LOCAL,
  );
  assert.deepEqual(out, {
    kind: "play",
    label: ANNOUNCEMENTS.UserPromptSubmit.label,
  });
});

test("Notification reproduce su anuncio pre-sintetizado (play fijo), ignora el mensaje", async () => {
  const out = await buildMessage(
    {
      hook_event_name: "Notification",
      message: "**Atención** necesita permiso",
    },
    LOCAL,
  );
  assert.deepEqual(out, {
    kind: "play",
    label: ANNOUNCEMENTS.Notification.label,
  });
});

test("SubagentStop reproduce su anuncio pre-sintetizado (play fijo)", async () => {
  const out = await buildMessage({ hook_event_name: "SubagentStop" }, LOCAL);
  assert.deepEqual(out, {
    kind: "play",
    label: ANNOUNCEMENTS.SubagentStop.label,
  });
});

test("StopFailure reproduce su anuncio pre-sintetizado (play fijo)", async () => {
  const out = await buildMessage({ hook_event_name: "StopFailure" }, LOCAL);
  assert.deepEqual(out, {
    kind: "play",
    label: ANNOUNCEMENTS.StopFailure.label,
  });
});

// --- Ruta Stop: umbral y degradación local ---

test("Stop (local) sin last_assistant cae al anuncio pre-sintetizado", async () => {
  const out = await buildMessage({ hook_event_name: "Stop" }, LOCAL);
  assert.deepEqual(out, { kind: "play", label: ANNOUNCEMENTS.Stop.label });
});

test("evento ausente/desconocido sin material degrada al anuncio Default (red de seguridad)", async () => {
  // Payload corrupto/indeterminado (JSON malformado o fallo de lectura del
  // traspaso interno): sin hook_event_name ni material, la última red es Default.
  const out = await buildMessage({}, LOCAL);
  assert.deepEqual(out, { kind: "play", label: ANNOUNCEMENTS.Default.label });
});

test("Stop con last_assistant solo-símbolos degrada al anuncio estático (umbral)", async () => {
  const out = await buildMessage(
    { hook_event_name: "Stop", last_assistant_message: "🎉🎉🎉" },
    LOCAL,
  );
  assert.deepEqual(out, { kind: "play", label: ANNOUNCEMENTS.Stop.label });
});

test("Stop (local) con last_assistant narra el resumen local vía say", async () => {
  const out = await buildMessage(
    { hook_event_name: "Stop", last_assistant_message: "Terminé la tarea." },
    LOCAL,
  );
  assert.deepEqual(out, { kind: "say", text: "Terminé la tarea." });
});

test("Stop con respuesta solo de código degrada al anuncio estático sin invocar al LLM", async () => {
  // El saneo descarta el cuerpo de los bloques cercados: sin prosa no hay
  // material narrable, así que ni el LLM ni el recorte local intervienen.
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    mockGemini("no debería llamarse");
    const out = await buildMessage(
      {
        hook_event_name: "Stop",
        last_assistant_message: '```js\nconst clave = "secreto";\n```',
      },
      LLM,
    );
    assert.deepEqual(out, { kind: "play", label: ANNOUNCEMENTS.Stop.label });
    assert.equal(lastBody, undefined, "ningún proveedor invocado");
  } finally {
    restoreEnv();
  }
});

test("Stop (local) narra solo las dos primeras oraciones del turno", async () => {
  const out = await buildMessage(
    {
      hook_event_name: "Stop",
      last_assistant_message:
        "Actualicé el saneo. Verifiqué la suite. Dejé un comentario. Pendiente: publicar.",
    },
    LOCAL,
  );
  assert.deepEqual(out, {
    kind: "say",
    text: "Actualicé el saneo. Verifiqué la suite.",
  });
});

test("Stop (local) conserva la prosa que rodea a un bloque de código", async () => {
  const out = await buildMessage(
    {
      hook_event_name: "Stop",
      last_assistant_message: [
        "Listo, apliqué el cambio.",
        "",
        "```ts",
        "export function foo() { return 1; }",
        "```",
        "",
        "Los tests pasan.",
      ].join("\n"),
    },
    LOCAL,
  );
  assert.deepEqual(out, {
    kind: "say",
    text: "Listo, apliqué el cambio. Los tests pasan.",
  });
});

// --- Ruta Stop vía Gemini (fetch mockeado) ---

const realFetch = globalThis.fetch;
let lastBody: unknown;

function mockGemini(text: string): void {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    lastBody = init ? JSON.parse(init.body as string) : undefined;
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  lastBody = undefined;
});

test("UserPromptSubmit (llm) NO invoca ningún LLM: acuse fijo play", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    mockGemini("no debería llamarse");
    const out = await buildMessage(
      { hook_event_name: "UserPromptSubmit", prompt: "nueva petición" },
      LLM,
    );
    assert.deepEqual(out, {
      kind: "play",
      label: ANNOUNCEMENTS.UserPromptSubmit.label,
    });
    assert.equal(lastBody, undefined);
  } finally {
    restoreEnv();
  }
});

test("Stop (llm) envía a Gemini un único mensaje user derivado solo de last_assistant_message", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    const payload: HookPayload = {
      hook_event_name: "Stop",
      last_assistant_message: "Creé el componente principal.",
    };

    mockGemini("Creé el componente principal");
    const out = await buildMessage(payload, LLM);
    assert.deepEqual(out, {
      kind: "say",
      text: "Creé el componente principal",
    });

    assert.deepEqual((lastBody as { contents: unknown[] }).contents, [
      {
        role: "user",
        parts: [
          {
            text: `Material del turno:\n\nCreé el componente principal.\n\n${SUMMARY_CLOSING}`,
          },
        ],
      },
    ]);
  } finally {
    restoreEnv();
  }
});

test("Stop (llm) ignora el transcript aunque transcript_path exista: solo va last_assistant_message", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    const transcriptPath = join(
      tmpdir(),
      `narrator-ignored-${Date.now()}.jsonl`,
    );
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          content: "<command-name>/model</command-name>",
        }),
        JSON.stringify({ type: "user", content: "Set model to Sonnet 5" }),
      ].join("\n"),
      "utf8",
    );

    const payload: HookPayload = {
      hook_event_name: "Stop",
      last_assistant_message: "Respondí la pregunta.",
      transcript_path: transcriptPath,
    };

    mockGemini("Respondí la pregunta");
    const out = await buildMessage(payload, LLM);
    assert.deepEqual(out, { kind: "say", text: "Respondí la pregunta" });

    const content = (
      lastBody as { contents: Array<{ parts: Array<{ text: string }> }> }
    ).contents[0].parts[0].text;
    assert.ok(content.includes("Respondí la pregunta."));
    assert.ok(!content.includes("Sonnet 5"));
    assert.ok(!content.includes("command-name"));
  } finally {
    restoreEnv();
  }
});

test("Caso «Hola»: turno trivial se narra fielmente, sin confabular", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    // El modelo, bajo el prompt anti-invención, narra el saludo como tal.
    mockGemini("Solo saludé de vuelta, sin cambios técnicos.");
    const out = await buildMessage(
      {
        hook_event_name: "Stop",
        last_assistant_message: "¡Hola! ¿En qué te ayudo?",
      },
      LLM,
    );
    assert.deepEqual(out, {
      kind: "say",
      text: "Solo saludé de vuelta, sin cambios técnicos.",
    });

    // Lo enviado al LLM es exactamente el saludo, nada más.
    const content = (
      lastBody as { contents: Array<{ parts: Array<{ text: string }> }> }
    ).contents[0].parts[0].text;
    assert.ok(content.includes("¡Hola! ¿En qué te ayudo?"));
  } finally {
    restoreEnv();
  }
});

test("Stop (llm) con LLM caído degrada al resumen local acotado (clampSentences)", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as typeof fetch;
    const out = await buildMessage(
      {
        hook_event_name: "Stop",
        last_assistant_message: "Trabajo completado.",
      },
      LLM,
    );
    assert.deepEqual(out, { kind: "say", text: "Trabajo completado." });
  } finally {
    restoreEnv();
  }
});

test("Stop (llm) sin API key degrada al resumen local sin invocar la red", async () => {
  const out = await buildMessage(
    {
      hook_event_name: "Stop",
      last_assistant_message: "Trabajo completado.",
    },
    { ...LLM, geminiApiKey: undefined },
  );
  assert.deepEqual(out, { kind: "say", text: "Trabajo completado." });
  assert.equal(lastBody, undefined);
});

test("Stop (llm) con LLM caído degrada a las dos primeras oraciones del turno", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as typeof fetch;
    const out = await buildMessage(
      {
        hook_event_name: "Stop",
        last_assistant_message:
          "Corregí el umbral. Los tests pasan. Queda revisar el roadmap.",
      },
      LLM,
    );
    assert.deepEqual(out, {
      kind: "say",
      text: "Corregí el umbral. Los tests pasan.",
    });
  } finally {
    restoreEnv();
  }
});

test("Stop (llm) sin last_assistant_message degrada limpiamente al anuncio play sin invocar LLM", async () => {
  const restoreEnv = withEnv({ GEMINI_API_KEY: "dummy" });
  try {
    const out = await buildMessage(
      { hook_event_name: "Stop", last_assistant_message: "" },
      LLM,
    );
    assert.deepEqual(out, { kind: "play", label: ANNOUNCEMENTS.Stop.label });
    assert.equal(lastBody, undefined);
  } finally {
    restoreEnv();
  }
});
