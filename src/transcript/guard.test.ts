// Guard del transcript enriquecido (guard.ts) con el kit oficial. El estado
// del guard vive en el módulo que carga el engine (dist/transcript.js), no en
// el que importaría este archivo, así que el apagado se observa por sus
// efectos: el toast y el dibujo nativo. Los fallos propios se provocan con un
// TodoWrite con `todos: [null]`, que hace lanzar a onToolCall antes de
// `next`. Cada test registra un único fondo por evento (el kit no admite dos).

import { describe, expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";
import {
  ENABLED,
  ENGINE_TEXT,
  countTicks,
  deferred,
  draw,
  engineRender,
  lifecycleBottom,
  memStore,
} from "./test-support.js";

const VERSION = "9.9.9";
const TOAST = new RegExp(
  `^Transcript enriquecido desactivado en esta sesión: tool\\.call: .+\\. Claude Code 9\\.9\\.9$`,
);

// Fondo común: store, dibujo, ciclo de vida, versión y registro de toasts.
function setup(on: On) {
  memStore(on);
  engineRender(on);
  lifecycleBottom(on);
  on("session.version", async () => ({ value: { version: VERSION } }) as never);
  const toasts: string[] = [];
  on("ui.toast", async ($, e) => {
    toasts.push(e.text);
    return { value: undefined } as never;
  });
  return { toasts, clock: mock.clock(on, { now: Date.now() }) };
}

// Llamada que hace fallar a onToolCall antes de `next`.
function badTodo($: Engine, id: string) {
  return $.tool.call({
    tool: "TodoWrite",
    tool_use_id: id,
    todos: [null],
  } as never);
}

function goodTodo($: Engine, id: string) {
  return $.tool.call({
    tool: "TodoWrite",
    tool_use_id: id,
    todos: [],
  } as never);
}

// ¿El transcript sigue envolviendo los bloques en su recuadro?
async function isWrapping($: Engine): Promise<boolean> {
  const ui = await draw($, "AssistantMessage", "probe", { text: "x" });
  const wrapped = JSON.stringify(await ui.drawn()).includes(
    '"borderStyle":"round"',
  );
  await ui.unmount();
  return wrapped;
}

// Recoge todos los chunks de un paso del modelo.
async function collectStep($: Engine, turnId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  const stream = $.turn
    .step({
      turnId,
      index: 0,
      model: "m",
      messageCount: 1,
    })
    [Symbol.asyncIterator]();
  for (;;) {
    const { value, done } = await stream.next();
    if (done) return out;
    out.push(value);
  }
}

describe("apagado", () => {
  test(
    "grupos vacíos consecutivos no apagan el transcript",
    ENABLED,
    async ($, on) => {
      const { toasts, clock } = setup(on);
      for (const id of ["a", "b", "c", "d"]) {
        const ui = await draw($, "ToolGroup", id, {
          calls: [],
          isActive: false,
        });
        expect(await ui.drawn()).toMatchObject({ children: [ENGINE_TEXT] });
        await ui.unmount();
      }
      await clock.settle();
      expect(toasts).toEqual([]);
      expect(await isWrapping($)).toBe(true);
    },
  );
  test(
    "tres fallos propios seguidos apagan el transcript con un único toast",
    ENABLED,
    async ($, on) => {
      const { toasts, clock } = setup(on);
      let runs = 0;
      on("tool.call", async () => {
        runs++;
        return { result: {}, text: "ok" } as never;
      });

      for (const id of ["a", "b"]) await badTodo($, id);
      await clock.settle();
      expect(toasts).toEqual([]);
      expect(await isWrapping($)).toBe(true);

      // El `.catch` cede a lo nativo: la herramienta corre igual.
      expect((await badTodo($, "c")).text).toBe("ok");
      await clock.settle();
      expect(runs).toBe(3);
      expect(toasts.length).toBe(1);
      expect(toasts[0]).toMatch(TOAST);

      // Apagado: los handlers ceden a lo nativo y no hay más toasts.
      expect((await badTodo($, "d")).text).toBe("ok");
      await clock.settle();
      expect(toasts.length).toBe(1);
      expect(await isWrapping($)).toBe(false);
      const ui = await draw($, "UserMessage", "r", {
        text: "x",
        origin: { kind: "composer" },
      });
      expect(await ui.drawn()).toMatchObject({ children: [ENGINE_TEXT] });
    },
  );

  test("un éxito intermedio reinicia la racha", ENABLED, async ($, on) => {
    const { toasts, clock } = setup(on);
    on("tool.call", async () => ({ result: {}, text: "ok" }) as never);
    await badTodo($, "a");
    await badTodo($, "b");
    await goodTodo($, "c");
    await badTodo($, "d");
    await badTodo($, "e");
    await clock.settle();
    expect(toasts).toEqual([]);
    expect(await isWrapping($)).toBe(true);
  });

  test(
    "los rechazos que vienen de abajo no cuentan",
    ENABLED,
    async ($, on) => {
      const { toasts, clock } = setup(on);
      // Un fondo que lanza deja la llamada sin implementación: `next` rechaza.
      on("tool.call", async () => {
        throw new Error("herramienta interrumpida");
      });
      for (const id of ["a", "b", "c", "d"]) {
        await expect(goodTodo($, id)).rejects.toThrow();
      }
      await clock.settle();
      expect(toasts).toEqual([]);
      expect(await isWrapping($)).toBe(true);
    },
  );
});

describe("sin efectos repetidos", () => {
  test(
    "un fallo propio después de next no vuelve a ejecutar la herramienta",
    ENABLED,
    async ($, on) => {
      setup(on);
      let runs = 0;
      on("tool.call", async () => {
        runs++;
        // TaskCreate: onToolCall lee `result.task` después de `next`.
        return {
          result: {
            get task(): never {
              throw new Error("resultado ilegible");
            },
          },
          text: "creada",
        } as never;
      });
      const out = await $.tool.call({
        tool: "TaskCreate",
        tool_use_id: "t1",
        subject: "x",
      } as never);
      expect(runs).toBe(1);
      expect(out.text).toBe("creada");
    },
  );

  test(
    "el stream de turn.step llega completo y sin duplicados, también apagado",
    ENABLED,
    async ($, on) => {
      const { toasts, clock } = setup(on);
      on("tool.call", async () => ({ result: {}, text: "ok" }) as never);
      const chunks = [
        { kind: "thinking", index: 0, text: "" },
        { kind: "text", index: 1, text: "a" },
        { kind: "text", index: 1, text: "b" },
      ];
      on("turn.step", async function* ($, e) {
        for (const chunk of chunks) yield chunk as never;
        return {
          turnId: e.turnId,
          index: e.index,
          answer: "",
          toolUses: [],
          stopReason: "end_turn",
          usage: null,
        } as never;
      });
      expect(await collectStep($, "t1")).toEqual(chunks);

      for (const id of ["a", "b", "c"]) await badTodo($, id);
      await clock.settle();
      expect(toasts.length).toBe(1);
      expect(await collectStep($, "t2")).toEqual(chunks);
    },
  );

  test(
    "un fallo propio antes de next no deja un contador huérfano",
    ENABLED,
    async ($, on) => {
      const { toasts, clock } = setup(on);
      const ticks = countTicks(on);
      on("tool.call", async () => ({ result: {}, text: "ok" }) as never);
      await badTodo($, "a");
      // El tic ya programado puede llegar una vez; después, el reloj se detiene.
      await clock.advance(2000);
      const before = ticks.count;
      await clock.advance(5000);
      expect(ticks.count).toBe(before);
      expect(toasts).toEqual([]);
    },
  );

  test("el reloj se detiene al apagarse", ENABLED, async ($, on) => {
    const { toasts, clock } = setup(on);
    const ticks = countTicks(on);
    const gate = deferred();
    on("tool.call", async ($, e) => {
      if (e.tool_use_id === "slow") await gate.promise;
      return { result: {}, text: "ok" } as never;
    });
    const slow = $.tool.call({
      tool: "Bash",
      command: "sleep",
      tool_use_id: "slow",
    } as never);
    await clock.settle();
    await clock.advance(2100);
    expect(ticks.count).toBeGreaterThan(0);

    for (const id of ["a", "b", "c"]) await badTodo($, id);
    await clock.settle();
    expect(toasts.length).toBe(1);
    const before = ticks.count;
    await clock.advance(5000);
    expect(ticks.count).toBe(before);

    gate.resolve();
    await slow;
  });
});
