// Hooks de ciclo de vida del transcript enriquecido (lifecycle.ts) con el kit
// oficial: cada escenario recorre los eventos como una sesión real y comprueba
// en el dibujo las horas y duraciones que fijaron. Los intervalos se miden en
// tiempo real (`spin`), así que se comprueba su orden de magnitud.

import { describe, expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";
import {
  ENABLED,
  deferred,
  draw,
  drain,
  engineRender,
  footerOf,
  headerOf,
  lifecycleBottom,
  memStore,
  spin,
} from "./test-support.js";

const HOUR = /🕐 \d{1,2}:\d\d:\d\d [ap]\.m\./;
// Duración de ~120 ms medida en tiempo real (0.1 s a 0.9 s).
const TENTHS = "0\\.[1-9]s";

function setup(on: On) {
  memStore(on);
  engineRender(on);
  lifecycleBottom(on);
  return mock.clock(on, { now: Date.now() });
}

// Fondo de turn.step: emite los chunks con una pausa real antes de cada uno.
function stepBottom(on: On, chunks: readonly object[], gapMs = 120): void {
  on("turn.step", async function* ($, e) {
    for (const chunk of chunks) {
      spin(gapMs);
      yield chunk as never;
    }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: "end_turn",
      usage: null,
    } as never;
  });
}

function step($: Engine, turnId: string, agentId?: string) {
  return drain(
    $.turn.step({
      turnId,
      index: 0,
      model: "m",
      messageCount: 1,
      ...(agentId ? { agentId } : {}),
    }),
  );
}

function appendRow(
  $: Engine,
  door: string,
  uuid: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const user = door === "prompt" || door === "command";
  return $.session.append({
    door,
    uuid,
    origin: user ? { kind: "composer" } : { kind: "model", model: "m" },
    message: {
      type: user ? "user" : "assistant",
      role: user ? "user" : "assistant",
      content: [{ type: "text", text }],
    },
    ...extra,
  } as never);
}

describe("turno simple", () => {
  test(
    "fija el 🔌 del prompt y el 🧠 de la respuesta",
    ENABLED,
    async ($, on) => {
      setup(on);
      stepBottom(on, [
        { kind: "text", index: 0, text: "Hola, " },
        { kind: "text", index: 0, text: "¿qué tal?" },
      ]);
      await $.prompt.submit({
        text: "hola",
        origin: { kind: "composer" },
      } as never);
      await appendRow($, "prompt", "U1", "hola");
      spin(120);
      await $.turn.start({ text: "hola", turnId: "t1" });
      await step($, "t1");
      await appendRow($, "response", "R1", "Hola, ¿qué tal?");
      await $.turn.complete({
        turnId: "t1",
        answer: "Hola, ¿qué tal?",
        durationMs: 400,
        isAborted: false,
        reason: "answer",
      } as never);

      const prompt = await draw($, "UserMessage", "U1", {
        text: "hola",
        origin: { kind: "composer" },
        isExpanded: false,
      });
      expect(await headerOf(prompt)).toMatch(HOUR);
      expect(await footerOf(prompt)).toMatch(new RegExp(`^ 🔌 ${TENTHS} $`));

      const answer = await draw($, "AssistantMessage", "R1", {
        text: "Hola, ¿qué tal?",
      });
      // Dos chunks con 120 ms antes de cada uno: el bloque dura ~0.2 s.
      expect(await footerOf(answer)).toMatch(new RegExp(`^ 🧠 ${TENTHS} $`));
    },
  );

  test(
    "un prompt que no viene del usuario no lleva 🔌",
    ENABLED,
    async ($, on) => {
      setup(on);
      await appendRow($, "prompt", "N1", "aviso", {
        origin: { kind: "task-notification" },
      });
      const row = await draw($, "UserMessage", "N1", {
        text: "aviso",
        origin: { kind: "task-notification" },
        isExpanded: false,
      });
      expect(await headerOf(row)).toMatch(HOUR);
      expect(await footerOf(row)).toBeUndefined();
    },
  );
});

describe("herramientas", () => {
  test(
    "ToolUse con contador mientras corre y 🔧 al terminar",
    ENABLED,
    async ($, on) => {
      const clock = setup(on);
      stepBottom(on, [
        { kind: "tool", index: 0, id: "tu1", name: "Bash" },
        { kind: "input", index: 0, json: '{"command":"ls"}' },
      ]);
      const gate = deferred();
      on("tool.call", async () => {
        await gate.promise;
        spin(120);
        return { result: "ok", text: "ok" } as never;
      });
      await $.turn.start({ text: "x", turnId: "t1" });
      await step($, "t1");
      const call = $.tool.call({
        tool: "Bash",
        command: "ls",
        tool_use_id: "tu1",
      } as never);
      await clock.settle();

      const use = await draw($, "ToolUse", "req-tu1", {
        tool: "Bash",
        tool_use_id: "tu1",
      });
      expect(await footerOf(use)).toMatch(
        new RegExp(`^ 🧠 ${TENTHS} · 🔧 0s… $`),
      );
      const running = await draw($, "ToolGroup", "grp", {
        calls: [{ tool_use_id: "tu1", isRunning: true }],
      });
      expect(await footerOf(running)).toBe(" 🔧 0s… ");

      gate.resolve();
      await call;
      await use.redraw();
      expect(await footerOf(use)).toMatch(new RegExp(`^ 🧠 ${TENTHS} $`));
      const result = await draw($, "ToolResult", "res-tu1", {
        tool: "Bash",
        tool_use_id: "tu1",
      });
      expect(await footerOf(result)).toMatch(new RegExp(`^ 🔧 ${TENTHS} $`));
      // Fuera del turno, el grupo ya no espera otra llamada y se cierra.
      await $.turn.complete({
        turnId: "t1",
        answer: "",
        durationMs: 1,
        isAborted: false,
        reason: "answer",
      } as never);
      const closed = await draw($, "ToolGroup", "grp2", {
        calls: [{ tool_use_id: "tu1" }],
      });
      expect(await footerOf(closed)).toMatch(new RegExp(`^ 🔧 ${TENTHS} $`));
    },
  );
});

describe("tareas", () => {
  async function spinnerMessage($: Engine): Promise<string | undefined> {
    const ui = await draw($, "Spinner", "session", {
      word: "Thinking…",
      message: null,
    });
    const text = (await ui.find({ type: "Text" }))?.text;
    await ui.unmount();
    return text;
  }

  test(
    "TodoWrite: el Spinner antepone la tarea en curso",
    ENABLED,
    async ($, on) => {
      setup(on);
      on("tool.call", async () => ({ result: {}, text: "ok" }) as never);
      await $.turn.start({ text: "x", turnId: "t1" });
      await $.tool.call({
        tool: "TodoWrite",
        tool_use_id: "todo1",
        todos: [
          { content: "Leer", activeForm: "Leyendo", status: "completed" },
          {
            content: "Escribir",
            activeForm: "Escribiendo",
            status: "in_progress",
          },
        ],
      } as never);
      expect(await spinnerMessage($)).toMatch(/\|🕐 .* · Escribiendo$/);
    },
  );

  test(
    "TaskCreate y TaskUpdate: la tarea en curso y su borrado",
    ENABLED,
    async ($, on) => {
      setup(on);
      on(
        "tool.call",
        async ($, e) =>
          (e.tool === "TaskCreate"
            ? { result: { task: { id: "7" } }, text: "Task #7 created" }
            : { result: {}, text: "ok" }) as never,
      );
      await $.turn.start({ text: "x", turnId: "t1" });
      await $.tool.call({
        tool: "TaskCreate",
        tool_use_id: "tc1",
        subject: "Probar",
        activeForm: "Probando",
      } as never);
      expect(await spinnerMessage($)).toMatch(/\|null$/);
      await $.tool.call({
        tool: "TaskUpdate",
        tool_use_id: "tu1",
        taskId: "7",
        status: "in_progress",
      } as never);
      expect(await spinnerMessage($)).toMatch(/\|🕐 .* · Probando$/);
      await $.tool.call({
        tool: "TaskUpdate",
        tool_use_id: "tu2",
        taskId: "7",
        status: "deleted",
      } as never);
      expect(await spinnerMessage($)).toMatch(/\|null$/);
    },
  );
});

describe("comandos", () => {
  test("CommandOutput lleva el 🔧 de command.run", ENABLED, async ($, on) => {
    setup(on);
    on("command.run", async () => {
      spin(120);
      return { text: "" };
    });
    await $.command.run({
      command: "foo",
      args: "",
      origin: { kind: "composer" },
    } as never);
    await appendRow($, "command", "C1", "<command-name>/foo</command-name>");
    await appendRow(
      $,
      "command",
      "C2",
      "<local-command-stdout>ok</local-command-stdout>",
    );
    const out = await draw($, "CommandOutput", "C2", { text: "ok" });
    expect(await footerOf(out)).toMatch(new RegExp(`^ 🔧 ${TENTHS} $`));
  });
});

describe("subagentes", () => {
  test(
    "su turno empieza con su primer paso y su respuesta lleva 🧠",
    ENABLED,
    async ($, on) => {
      setup(on);
      stepBottom(on, [{ kind: "text", index: 0, text: "Hecho" }]);
      await step($, "ta", "a1");
      await appendRow($, "response", "RA", "Hecho", { agentId: "a1" });
      const answer = await draw($, "AssistantMessage", "RA", { text: "Hecho" });
      expect(await footerOf(answer)).toMatch(new RegExp(`^ 🧠 ${TENTHS} $`));

      const spinner = await draw($, "Spinner", "a1", {
        word: "Working…",
        message: null,
      });
      expect((await spinner.find({ type: "Text" }))?.text).toMatch(
        /^🕐 .* · Working…\|null$/,
      );
    },
  );
});
