// Persistencia del transcript enriquecido (timing-store.ts) con el kit
// oficial: volcado diferido de lo fijado por los eventos, recarga de una
// sesión reanudada, caducidad de los días de más de 30 y recorte por el
// presupuesto de 3,5 MiB.

import { describe, expect, mock, test } from "claude-code/testing";
import { formatClockTime } from "./format.js";
import {
  ENABLED,
  dayKey,
  draw,
  engineRender,
  headerOf,
  memStore,
} from "./test-support.js";

const DAY_MS = 86_400_000;
const MAX_STORE_BYTES = 3_670_016;

describe("pinTiming y flush", () => {
  test(
    "lo fijado se vuelca una sola vez, un segundo después",
    ENABLED,
    async ($, on) => {
      const store = memStore(on);
      const clock = mock.clock(on, { now: Date.now() });
      on("tool.call", async () => ({ result: "ok", text: "ok" }) as never);
      await $.tool.call({
        tool: "Bash",
        command: "a",
        tool_use_id: "x1",
      } as never);
      await $.tool.call({
        tool: "Bash",
        command: "b",
        tool_use_id: "x2",
      } as never);
      await clock.advance(999);
      expect(store.writes.filter((w) => w.startsWith("set"))).toEqual([]);
      await clock.advance(1);
      const today = dayKey(Date.now());
      expect(store.writes).toEqual([`set ${today}`]);
      const bucket = store.data.get(today) as Record<string, { h: number }>;
      expect(Object.keys(bucket).sort()).toEqual(["r:x1", "r:x2"]);
    },
  );

  test(
    "el volcado fusiona con lo que otra sesión ya guardó",
    ENABLED,
    async ($, on) => {
      const today = dayKey(Date.now());
      const store = memStore(on, { [today]: { ajena: { h: 1 } } });
      const clock = mock.clock(on, { now: Date.now() });
      on("tool.call", async () => ({ result: "ok", text: "ok" }) as never);
      await $.tool.call({
        tool: "Bash",
        command: "a",
        tool_use_id: "x1",
      } as never);
      await clock.advance(1000);
      expect(Object.keys(store.data.get(today) as object).sort()).toEqual([
        "ajena",
        "r:x1",
      ]);
    },
  );
});

describe("loadStore", () => {
  test(
    "una sesión reanudada muestra la hora guardada",
    ENABLED,
    async ($, on) => {
      const h = Date.now() - 3_600_000;
      memStore(on, { [dayKey(h)]: { R9: { h, d: 1_000 } } });
      engineRender(on);
      const ui = await draw($, "AssistantMessage", "R9", { text: "r" });
      expect(await headerOf(ui)).toBe(
        ` 🕐 ${formatClockTime(h)} | AssistantMessage `,
      );
    },
  );

  test(
    "borra los días de más de 30 y conserva el resto",
    ENABLED,
    async ($, on) => {
      const old = dayKey(Date.now() - 31 * DAY_MS);
      const recent = dayKey(Date.now() - 29 * DAY_MS);
      const store = memStore(on, {
        [old]: { a: { h: 1 } },
        [recent]: { b: { h: 2 } },
      });
      engineRender(on);
      await draw($, "AssistantMessage", "R1", { text: "r" });
      expect(store.writes).toEqual([`delete ${old}`]);
      expect(store.data.has(recent)).toBe(true);
    },
  );

  test(
    "recorta los días más antiguos que excedan el presupuesto",
    ENABLED,
    async ($, on) => {
      // Tres días de ~1,46 MiB: ~4,4 MiB superan el presupuesto de 3,5 MiB.
      const big = (tag: string) => ({
        [tag + "x".repeat(Math.ceil(MAX_STORE_BYTES / 2.4))]: { h: 1 },
      });
      const days = [3, 2, 1].map((n) => dayKey(Date.now() - n * DAY_MS));
      const store = memStore(on, {
        [days[0]!]: big("a"),
        [days[1]!]: big("b"),
        [days[2]!]: big("c"),
      });
      engineRender(on);
      await draw($, "AssistantMessage", "R1", { text: "r" });
      expect(store.writes).toEqual([`delete ${days[0]}`]);
      expect(store.data.has(days[1]!)).toBe(true);
      expect(store.data.has(days[2]!)).toBe(true);
    },
  );
});
