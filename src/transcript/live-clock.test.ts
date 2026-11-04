// Reloj de los contadores en vivo (live-clock.ts) con el kit oficial y el
// reloj simulado: cada tic escribe `second` en `$.state`, así que contar esas
// escrituras dice cuándo hizo tic. La hora de inicio de cada contador sale de
// `Date.now()` real, de modo que el primer cruce cae ~1 s después del inicio.

import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import {
  ENABLED,
  dayKey,
  deferred,
  draw,
  engineRender,
  memStore,
  spin,
} from "./test-support.js";

// Cuenta las escrituras de `second` en `$.state`.
function countTicks(on: On): { count: number } {
  const ticks = { count: 0 };
  on("state.set", async ($, e, next) => {
    ticks.count++;
    return next(e);
  });
  return ticks;
}

// Una tool.call que no termina hasta que el test lo pide.
function gatedCall(on: On) {
  const gate = deferred();
  on("tool.call", async () => {
    await gate.promise;
    return { result: "ok", text: "ok" } as never;
  });
  return gate;
}

describe("scheduleClock", () => {
  test(
    "hace tic al cruzar el segundo de la llamada en curso",
    ENABLED,
    async ($, on) => {
      memStore(on);
      const clock = mock.clock(on, { now: Date.now() });
      const ticks = countTicks(on);
      gatedCall(on);
      void $.tool.call({
        tool: "Bash",
        command: "ls",
        tool_use_id: "c1",
      } as never);
      await clock.settle();
      const atStart = ticks.count; // la escritura del arranque de la llamada
      await clock.advance(900);
      expect(ticks.count).toBe(atStart);
      await clock.advance(200);
      expect(ticks.count).toBe(atStart + 1);
      await clock.advance(1_000);
      expect(ticks.count).toBe(atStart + 2);
    },
  );

  test("se reprograma ante un cruce anterior", ENABLED, async ($, on) => {
    // Una llamada terminada hace 1,5 s cuyo grupo sigue en curso cruza su
    // segundo ~0,5 s después: antes que la llamada recién arrancada.
    const start = Date.now() - 1_500;
    memStore(on, { [dayKey(start)]: { "r:old": { h: start, d: 100 } } });
    engineRender(on);
    const clock = mock.clock(on, { now: Date.now() });
    const ticks = countTicks(on);
    gatedCall(on);
    void $.tool.call({
      tool: "Bash",
      command: "ls",
      tool_use_id: "c1",
    } as never);
    await clock.settle();
    await draw($, "ToolGroup", "grp", {
      calls: [{ tool_use_id: "old", isRunning: true }],
    });
    const before = ticks.count;
    await clock.advance(600);
    // El cruce de la llamada nueva cae a ~1 s: cualquier tic en estos 600 ms
    // viene del cruce anterior. Se exige al menos uno y no exactamente uno
    // porque los cruces se calculan con el reloj real y el avance es simulado:
    // si la preparación tarda, el tic se reprograma sobre el mismo cruce, que
    // el reloj real aún no alcanzó, y vuelve a caer dentro de la ventana.
    expect(ticks.count).toBeGreaterThan(before);
  });

  test(
    "se apaga sin llamadas en curso ni grupos abiertos",
    ENABLED,
    async ($, on) => {
      memStore(on);
      const clock = mock.clock(on, { now: Date.now() });
      const ticks = countTicks(on);
      const gate = gatedCall(on);
      const call = $.tool.call({
        tool: "Bash",
        command: "ls",
        tool_use_id: "c1",
      } as never);
      await clock.settle();
      gate.resolve();
      await call;
      await clock.advance(1_100); // el tic ya programado, que apaga el reloj
      const after = ticks.count;
      await clock.advance(5_000);
      expect(ticks.count).toBe(after);
    },
  );

  test(
    "un grupo sin dibujarse durante 3 s deja de mantener el reloj",
    { ...ENABLED, timeoutMs: 10_000 },
    async ($, on) => {
      memStore(on);
      engineRender(on);
      const clock = mock.clock(on, { now: Date.now() });
      const ticks = countTicks(on);
      const ui = await draw($, "ToolGroup", "grp", {
        calls: [{ tool_use_id: "g1", isRunning: true }],
      });
      await ui.unmount();
      spin(3_100); // más que COUNTER_EXPIRY_MS sin volver a dibujarse
      await clock.advance(1_100); // el tic encuentra el grupo vencido
      const after = ticks.count;
      await clock.advance(5_000);
      expect(ticks.count).toBe(after);
    },
  );
});
