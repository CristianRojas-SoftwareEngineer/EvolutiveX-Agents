// Utilidades compartidas por los tests del transcript enriquecido, que corren
// con el kit oficial (`claude plugin test`) contra dist/transcript.js. No lo
// importa index.ts, así que no forma parte del módulo empaquetado.
//
// Las horas y duraciones del transcript salen de `Date.now()` real (no del
// reloj simulado, que solo gobierna los temporizadores de `$.clock`): los
// tests miden intervalos reales con `spin` o fijan horas exactas precargando
// el store.

import type { On, RenderComponent, RenderPropsOf } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";
import { pad2 } from "./format.js";

export const PLUGIN = "evolutivex-agents";
export const ENABLED = { options: { enhancedTranscript: true } } as const;
export const ENGINE_TEXT = "ENGINE";

// Store en memoria bajo los plugins, con registro de escrituras. Reemplaza a
// `mock.store` porque el test no puede registrar dos veces un mismo evento y
// necesita observar qué se escribe y qué se borra.
export function memStore(on: On, initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const writes: string[] = [];
  on("store.get", async ($, e) => ({ value: data.get(e.key) ?? null }));
  on("store.set", async ($, e) => {
    writes.push(`set ${e.key}`);
    data.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", async ($, e) => {
    writes.push(`delete ${e.key}`);
    data.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", async () => ({ value: [...data.keys()] }));
  return { data, writes };
}

// Dibujo del engine bajo los plugins: un Text con la palabra y el mensaje del
// Spinner o de TurnDuration (para leer lo que el plugin les antepone), el nodo
// del engine en el diálogo de AskUserQuestion (que exige exactamente uno) o,
// en el resto, un marcador fijo.
export function engineRender(on: On): void {
  on("ui.render", async ($, e) => {
    if (e.component === "AskUserQuestion")
      return { type: "engine", ref: 0 } as never;
    const props = e.props as { word?: string; message?: string | null };
    const text =
      props.word === undefined
        ? ENGINE_TEXT
        : `${props.word}|${props.message ?? "null"}`;
    return { type: "Text", props: {}, children: [text] } as never;
  });
}

// Dibuja un componente del transcript en la terminal.
export function draw<C extends RenderComponent>(
  $: Engine,
  component: C,
  requestId: string,
  props: Record<string, unknown>,
  columns?: number,
): Promise<Mounted<"terminal", C>> {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: "terminal",
    component,
    requestId,
    props: props as unknown as RenderPropsOf[C],
    ...(columns ? { viewport: { columns, rows: 40 } as never } : {}),
  });
}

// Header (`🕐 …`) y footer (cifras) de un bloque dibujado; undefined si no hay.
export async function headerOf(
  ui: Pick<Mounted, "find">,
): Promise<string | undefined> {
  return (await ui.find({ type: "Text", text: "🕐" }))?.text;
}

export async function footerOf(
  ui: Pick<Mounted, "find">,
): Promise<string | undefined> {
  return (await ui.find({ type: "Text", text: /🔌|🧠|🔧|👤/ }))?.text;
}

// Espera activa de tiempo real: hace avanzar `Date.now()` sin el reloj simulado.
export function spin(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Espera activa.
  }
}

// Promesa que el test resuelve cuando quiere (p. ej. el fin de una tool.call).
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

// Clave del bucket diario del store para un instante, como la escribe el plugin.
export function dayKey(ms: number): string {
  const f = new Date(ms);
  return `days/${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}

// Consume entero el stream de un `turn.step`.
export async function drain(stream: AsyncIterator<unknown>): Promise<void> {
  for (;;) if ((await stream.next()).done) return;
}

// Cuenta las escrituras de `second` en `$.state` (usa `on` en lugar de `mock`).
export function countTicks(on: On): { count: number } {
  const ticks = { count: 0 };
  on("state.set", async ($, e, next) => {
    if (e.key === "second" && e.plugin === "evolutivex-agents") ticks.count++;
    return next(e);
  });
  return ticks;
}

// Fondo de los eventos de ciclo de vida que el kit no responde por su cuenta.
export function lifecycleBottom(on: On): void {
  on("prompt.submit", async ($, e) => ({ text: e.text }));
  on("turn.start", async ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", async ($, e) => ({ text: e.answer }));
}
