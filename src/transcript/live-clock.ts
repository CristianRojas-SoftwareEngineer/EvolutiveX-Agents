import type { EngineInterface, Timer } from "claude-code";
import { runningCalls, counters } from "./session.js";

// Próximo tic del reloj de los contadores: `{ timer, at }` (epoch ms).
let clock: { timer: Timer; at: number } | undefined;
// Retraso tras el cruce de segundo, para que el redibujo ya lo vea cruzado.
const TICK_MARGIN_MS = 20;

// Un grupo abierto que no se dibuja en este plazo (terminó o su vista se
// cerró mientras no se dibujaba) deja de mantener el reloj.
const COUNTER_EXPIRY_MS = 3000;

// Programa el próximo tic en el primer instante en que algún contador cruza
// un segundo entero desde su inicio: el de un ToolUse (inicio de su llamada) o
// el de un ToolGroup abierto (inicio del grupo, aunque ninguna herramienta
// corra: el modelo puede estar generando la siguiente llamada). Cada número
// aparece justo al cumplirse, sin redibujar más de una vez por segundo y
// contador. Se reprograma si llega un cruce anterior (withTimestamp la invoca
// al dibujar un bloque suscrito) y se apaga sin llamadas ni grupos abiertos.
export function scheduleClock($: EngineInterface): void {
  const now = Date.now();
  for (const [blockKey, c] of counters) {
    if (c.seen < now - COUNTER_EXPIRY_MS) counters.delete(blockKey);
  }
  if (!runningCalls.size && !counters.size) {
    clock?.timer.cancel();
    clock = undefined;
    return;
  }
  const starts = [
    ...runningCalls.values(),
    ...[...counters.values()].map((c) => c.start),
  ];
  const at =
    Math.min(
      ...starts.map((h) => h + (Math.floor((now - h) / 1000) + 1) * 1000),
    ) + TICK_MARGIN_MS;
  if (clock && clock.at <= at) return;
  clock?.timer.cancel();
  clock = {
    at,
    timer: $.clock.after(at - now, () => {
      clock = undefined;
      void $.state.set(
        { plugin: "evolutivex-agents", key: "second" },
        Date.now(),
      );
      scheduleClock($);
    }),
  };
}
