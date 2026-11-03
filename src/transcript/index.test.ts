// Activación del transcript enriquecido (index.ts) con el kit oficial: con
// `enhancedTranscript` desactivado (el valor por defecto) no envuelve nada;
// activado, sí.

import { expect, test } from "claude-code/testing";
import {
  ENABLED,
  ENGINE_TEXT,
  draw,
  engineRender,
  memStore,
} from "./test-support.js";

const ENGINE_TREE = { type: "Text", children: [ENGINE_TEXT] };

for (const options of [{}, { options: { enhancedTranscript: false } }]) {
  test(
    `desactivado (${JSON.stringify(options)}): ningún componente se envuelve`,
    options,
    async ($, on) => {
      memStore(on);
      engineRender(on);
      for (const component of [
        "UserMessage",
        "AssistantMessage",
        "ToolResult",
      ] as const) {
        const ui = await draw($, component, `r-${component}`, {
          text: "x",
          tool: "Bash",
          tool_use_id: "t",
          origin: { kind: "composer" },
          isExpanded: false,
        });
        expect(await ui.drawn()).toMatchObject(ENGINE_TREE);
      }
      const spinner = await draw($, "Spinner", "s", {
        word: "Thinking…",
        message: null,
      });
      expect((await spinner.find({ type: "Text" }))?.text).toBe(
        "Thinking…|null",
      );
    },
  );
}

test(
  "activado: los componentes se envuelven en el recuadro",
  ENABLED,
  async ($, on) => {
    memStore(on);
    engineRender(on);
    const ui = await draw($, "AssistantMessage", "r", { text: "x" });
    expect(JSON.stringify(await ui.drawn())).toContain('"borderStyle":"round"');
  },
);
