import type { EngineInterface } from "claude-code";
import { counters, runningCalls } from "./session.js";

// ── Protección del transcript enriquecido ───────────────────────────────────
//
// Si un handler, el reloj o el volcado del store fallan por su propio código
// (una excepción o un `timeout` del engine) FAILURE_LIMIT veces seguidas bajo
// un mismo nombre, el transcript enriquecido se apaga hasta el final de la
// sesión (o una recarga del plugin): los handlers ceden a lo nativo, el reloj
// se detiene y se muestra un único toast con la causa. Un éxito reinicia la
// racha de su nombre, y un rechazo que viene de abajo de la cadena (otro
// plugin, la herramienta, el engine) no cuenta. El estado vive en la memoria
// del módulo.
//
// El engine analiza el módulo y exige que `$` solo pase a funciones
// declaradas o importadas por nombre, así que no hay envoltorios de orden
// superior: cada registro de index.ts es un literal que llama a guardCall con
// su handler, y su `.catch` llama a caught (o a countTimeout en turn.step).

const FAILURE_LIMIT = 3;

// Racha de fallos seguidos por nombre (los 10 handlers, `clock` y `flush`).
const streaks = new Map<string, number>();
let disabled = false;
// Lo que se apaga junto con el transcript (el reloj de live-clock).
const disableListeners: (() => void)[] = [];
// Rechazos que vienen de abajo de la cadena (marcados por `below`).
const belowErrors = new WeakSet<object>();

export const isDisabled = (): boolean => disabled;

// Registra algo que debe detenerse al apagarse el transcript.
export function onDisable(listener: () => void): void {
  disableListeners.push(listener);
}

export function recordSuccess(name: string): void {
  streaks.delete(name);
}

// Cuenta un fallo propio de `name`; al llegar al límite apaga el transcript y
// avisa una sola vez con la causa y la versión de Claude Code.
export function recordFailure(
  $: EngineInterface,
  name: string,
  message: string,
): void {
  if (disabled) return;
  const streak = (streaks.get(name) ?? 0) + 1;
  streaks.set(name, streak);
  if (streak < FAILURE_LIMIT) return;
  disabled = true;
  for (const listener of disableListeners) listener();
  runningCalls.clear();
  counters.clear();
  void $.session
    .version()
    .catch(() => undefined)
    .then((v) =>
      $.ui.toast(
        `Transcript enriquecido desactivado en esta sesión: ${name}: ${message}. Claude Code ${v?.version ?? "desconocida"}`,
      ),
    );
}

export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// Marca el rechazo de lo de abajo (`below(next(e))`) para que no cuente como
// fallo propio del handler que lo recibe.
export function below<T>(pending: Promise<T>): Promise<T> {
  return pending.catch((err: unknown) => {
    if (typeof err === "object" && err !== null) belowErrors.add(err);
    throw err;
  });
}

const isBelow = (err: unknown): boolean =>
  typeof err === "object" && err !== null && belowErrors.has(err);

// Ejecuta un handler no streaming bajo el guard: apagado el transcript, cede
// a lo nativo (`native`, que es `next(e)`); si no, registra el éxito o cuenta
// el fallo propio y lo relanza para que lo atienda el `.catch` del registro.
export async function guardCall<R>(
  $: EngineInterface,
  name: string,
  run: () => Promise<R>,
  native: () => Promise<R>,
): Promise<R> {
  if (disabled) return native();
  try {
    const result = await run();
    recordSuccess(name);
    return result;
  } catch (err) {
    if (!isBelow(err)) recordFailure($, name, messageOf(err));
    throw err;
  }
}

// Lo que un `.catch` lee en `next.error`: por qué falló el hook.
type HookFailure = { readonly kind: "throw" | "timeout"; message?: string };

// Cuenta el `timeout` de un hook: las excepciones ya las contó guardCall (u
// onStep), o venían de abajo.
export function countTimeout(
  $: EngineInterface,
  name: string,
  error: HookFailure,
): void {
  if (error.kind === "timeout")
    recordFailure($, name, error.message ?? "timeout");
}

// Handler del `.catch` de un registro no streaming: cuenta el `timeout` y
// responde con `next(e)`, que en un `.catch` reutiliza el resultado ya
// obtenido sin volver a ejecutar lo de abajo (la herramienta, en tool.call)
// y, si lo de abajo había rechazado, propaga ese rechazo.
export function caught<E, R>(
  $: EngineInterface,
  name: string,
  e: E,
  next: ((e: E) => R) & { readonly error: HookFailure },
): R {
  countTimeout($, name, next.error);
  return next(e);
}

// Igual que `below` pero para un stream: marca sus rechazos como "de abajo"
// para que no cuenten.
export function belowStream<C, R>(
  stream: AsyncGenerator<C, R> & { readonly result: Promise<R> },
): AsyncGenerator<C, R> & { readonly result: Promise<R> } {
  async function* inner(): AsyncGenerator<C, R> {
    try {
      for await (const chunk of stream) yield chunk;
      return await stream.result;
    } catch (err) {
      if (typeof err === "object" && err !== null) belowErrors.add(err);
      throw err;
    }
  }
  const gen = inner();
  return Object.assign(gen, { result: stream.result });
}
