// Dibujo del transcript enriquecido (render.ts) con el kit oficial: recuadro,
// header y footer de cada componente a partir de horas y duraciones fijadas
// en el store (como en una sesión reanudada), el diálogo de AskUserQuestion,
// los componentes sin envolver, Spinner, TurnDuration y la vista ctrl+o.

import { describe, expect, test } from "claude-code/testing";
import { formatClockTime } from "./format.js";
import {
  ENABLED,
  ENGINE_TEXT,
  dayKey,
  draw,
  engineRender,
  footerOf,
  headerOf,
  lifecycleBottom,
  memStore,
} from "./test-support.js";

// Horas fijas de hace un minuto, todas en el mismo día local.
const BASE = Date.now() - 60_000;
const at = (offsetMs: number) => BASE + offsetMs;
const header = (offsetMs: number, component: string) =>
  ` 🕐 ${formatClockTime(at(offsetMs))} | ${component} `;

const STORED = {
  [dayKey(BASE)]: {
    U1: { h: at(0), d: 2_500 },
    A1: { h: at(1_000), d: 3_200 },
    "u:t1": { h: at(2_000), d: 1_200 },
    "r:t1": { h: at(4_000), d: 65_000 },
    "r:t2": { h: at(70_000), d: 5_000 },
    "r:ask": { h: at(80_000), d: 12_000 },
    "r:agent": { h: at(90_000), d: 1_500 },
    C1: { h: at(100_000), d: 450 },
    TD1: { h: at(110_000) },
  },
};

describe("withTimestamp", () => {
  test("UserMessage: recuadro, hora de envío y 🔌", ENABLED, async ($, on) => {
    memStore(on, STORED);
    engineRender(on);
    const ui = await draw($, "UserMessage", "U1", {
      text: "hola",
      origin: { kind: "composer" },
      isExpanded: false,
    });
    const drawn = JSON.stringify(await ui.drawn());
    expect(drawn).toContain('"borderStyle":"round"');
    expect(drawn).toContain(ENGINE_TEXT);
    expect(await headerOf(ui)).toBe(header(0, "UserMessage"));
    expect(await footerOf(ui)).toBe(" 🔌 2.5s ");
  });

  test("UserMessage de otro origen: solo la hora", ENABLED, async ($, on) => {
    memStore(on, STORED);
    engineRender(on);
    const ui = await draw($, "UserMessage", "U1", {
      text: "aviso",
      origin: { kind: "task-notification" },
      isExpanded: false,
    });
    expect(await headerOf(ui)).toBe(header(0, "UserMessage"));
    expect(await footerOf(ui)).toBeUndefined();
  });

  test("AssistantMessage: 🧠 y margen absorbido", ENABLED, async ($, on) => {
    memStore(on, STORED);
    engineRender(on);
    const ui = await draw($, "AssistantMessage", "A1", { text: "respuesta" });
    expect(await headerOf(ui)).toBe(header(1_000, "AssistantMessage"));
    expect(await footerOf(ui)).toBe(" 🧠 3.2s ");
    expect(JSON.stringify(await ui.drawn())).toContain('"marginTop":-1');
  });

  test("ToolUse: 🧠 de la escritura de la llamada", ENABLED, async ($, on) => {
    memStore(on, STORED);
    engineRender(on);
    const ui = await draw($, "ToolUse", "req-t1", {
      tool: "Bash",
      tool_use_id: "t1",
    });
    expect(await headerOf(ui)).toBe(header(2_000, "ToolUse"));
    expect(await footerOf(ui)).toBe(" 🧠 1.2s ");
  });

  test(
    "ToolResult: 🔧; 👤 en AskUserQuestion; sin margen en Agent",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      const bash = await draw($, "ToolResult", "res-t1", {
        tool: "Bash",
        tool_use_id: "t1",
      });
      expect(await headerOf(bash)).toBe(header(4_000, "ToolResult"));
      expect(await footerOf(bash)).toBe(" 🔧 1m 05s ");
      const ask = await draw($, "ToolResult", "res-ask", {
        tool: "AskUserQuestion",
        tool_use_id: "ask",
      });
      expect(await footerOf(ask)).toBe(" 👤 12s ");
      const agent = await draw($, "ToolResult", "res-agent", {
        tool: "Agent",
        tool_use_id: "agent",
      });
      expect(JSON.stringify(await agent.drawn())).toContain('"marginTop":0');
    },
  );

  test(
    "ToolGroup cerrado: del inicio de la primera al fin de la última",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      const ui = await draw($, "ToolGroup", "grp", {
        calls: [{ tool_use_id: "t1" }, { tool_use_id: "t2" }],
        isActive: false,
      });
      expect(await headerOf(ui)).toBe(header(4_000, "ToolGroup"));
      // Fin de t2 (70 s + 5 s) menos inicio de t1 (4 s) = 71 s.
      expect(await footerOf(ui)).toBe(" 🔧 1m 11s ");
    },
  );

  test(
    "ToolGroup vacío o con algún ID ausente delega al engine",
    ENABLED,
    async ($, on) => {
      memStore(on, {
        [dayKey(BASE)]: {
          ...STORED[dayKey(BASE)],
          "r:undefined": { h: at(0), d: 90_000 },
        },
      });
      engineRender(on);
      const cases = [
        [],
        [{}],
        [{ tool_use_id: "t1" }, {}],
        [{}, { tool_use_id: "t1" }],
        [{ tool_use_id: "" }],
      ];
      for (const [i, calls] of cases.entries()) {
        for (const isActive of [false, true]) {
          const ui = await draw($, "ToolGroup", `invalid-${i}-${isActive}`, {
            calls,
            isActive,
          });
          expect(await ui.drawn()).toMatchObject({
            type: "Text",
            children: [ENGINE_TEXT],
          });
          await ui.unmount();
        }
      }
    },
  );

  test("CommandOutput: 🔧 y sin margen propio", ENABLED, async ($, on) => {
    memStore(on, STORED);
    engineRender(on);
    const ui = await draw($, "CommandOutput", "C1", { text: "ok" });
    expect(await headerOf(ui)).toBe(header(100_000, "CommandOutput"));
    expect(await footerOf(ui)).toBe(" 🔧 0.5s ");
    expect(JSON.stringify(await ui.drawn())).toContain('"marginTop":0');
  });

  test(
    "AskUserQuestion: solo el header, en flujo y sin recuadro",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      const ui = await draw($, "AskUserQuestion", "ask", {
        tool: "AskUserQuestion",
        questions: [],
      });
      const drawn = await ui.drawn();
      expect(JSON.stringify(drawn)).not.toContain("borderStyle");
      expect(await headerOf(ui)).toBe(header(80_000, "AskUserQuestion"));
      expect(await footerOf(ui)).toBeUndefined();
    },
  );

  test(
    "sin envolver: ToolUse de AskUserQuestion y de SubagentHandback",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      for (const tool of ["AskUserQuestion", "SubagentHandback"]) {
        const ui = await draw($, "ToolUse", `req-${tool}`, {
          tool,
          tool_use_id: `id-${tool}`,
        });
        expect(await ui.drawn()).toMatchObject({
          type: "Text",
          children: [ENGINE_TEXT],
        });
      }
    },
  );

  test(
    "el espaciador fija el ancho al del viewport",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      const ui = await draw($, "AssistantMessage", "A1", { text: "r" }, 60);
      expect(JSON.stringify(await ui.drawn())).toContain(`"${" ".repeat(58)}"`);
    },
  );

  test(
    "vista ctrl+o: AssistantMessage sin margen propio",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      // Un ToolResult con isExpanded informa de la vista activa.
      await draw($, "ToolResult", "res-t1", {
        tool: "Bash",
        tool_use_id: "t1",
        isExpanded: true,
      });
      const expanded = await draw($, "AssistantMessage", "A1", { text: "r" });
      expect(JSON.stringify(await expanded.drawn())).toContain('"marginTop":0');
      await draw($, "ToolResult", "res-t1b", {
        tool: "Bash",
        tool_use_id: "t1",
        isExpanded: false,
      });
      const compact = await draw($, "AssistantMessage", "A1b", { text: "r" });
      expect(JSON.stringify(await compact.drawn())).toContain('"marginTop":-1');
    },
  );
});

describe("withSpinner", () => {
  test("sin turno registrado lo deja intacto", ENABLED, async ($, on) => {
    memStore(on);
    engineRender(on);
    const ui = await draw($, "Spinner", "session", {
      word: "Thinking…",
      message: null,
    });
    expect((await ui.find({ type: "Text" }))?.text).toBe("Thinking…|null");
  });

  test(
    "antepone el inicio del turno a la palabra y al mensaje",
    ENABLED,
    async ($, on) => {
      memStore(on);
      engineRender(on);
      lifecycleBottom(on);
      await $.turn.start({ text: "hola", turnId: "t1" });
      const ui = await draw($, "Spinner", "session", {
        word: "Thinking…",
        message: "Leyendo",
      });
      expect((await ui.find({ type: "Text" }))?.text).toMatch(
        /^🕐 \d{1,2}:\d\d:\d\d [ap]\.m\. · Thinking…\|🕐 \d{1,2}:\d\d:\d\d [ap]\.m\. · Leyendo$/,
      );
    },
  );
});

describe("withTurnDuration", () => {
  test(
    "antepone el fin del turno, fijado en su fila",
    ENABLED,
    async ($, on) => {
      memStore(on, STORED);
      engineRender(on);
      const ui = await draw($, "TurnDuration", "TD1", {
        word: "Completed in",
        durationMs: 15_300,
      });
      expect((await ui.find({ type: "Text" }))?.text).toBe(
        `🕐 ${formatClockTime(at(110_000))} · Completed in|null`,
      );
    },
  );
});
