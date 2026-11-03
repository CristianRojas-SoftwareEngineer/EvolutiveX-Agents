import type { Frozen, RenderInput } from "claude-code";
import {
  counters,
  isUserOrigin,
  lastCall,
  runningCalls,
  session,
} from "./session.js";
import { blocks, entryFor } from "./timing-store.js";

// ── Footers por componente ──────────────────────────────────────────────────

// Componentes del transcript que envuelve withTimestamp.
export type TranscriptComponent =
  | "UserMessage"
  | "AssistantMessage"
  | "ToolUse"
  | "ToolResult"
  | "ToolGroup"
  | "CommandOutput"
  | "AskUserQuestion";

// Lo que RESOLVER da para dibujar un bloque: `unwrapped` lo deja sin
// envolver; si no, su hora y, según el componente, duración, icono, contador
// en vivo, suscripción al reloj, márgenes, diálogo o clave por persistir.
type Resolved =
  | { unwrapped: true }
  | {
      unwrapped?: undefined;
      time: number;
      duration?: number;
      fromEvent?: boolean;
      icon?: string;
      counter?: number;
      subscribed?: boolean;
      noMargin?: boolean;
      dialog?: boolean;
      toSave?: string;
    };

type ToolGroupCall = Frozen<RenderInput<"ToolGroup">>["props"]["calls"][number];

// Un grupo cuya llamada es la última de su agente sigue abierto aunque todas
// hayan terminado: el modelo puede estar generando la siguiente. Es
// provisional: si llega texto o termina el turno, el grupo se cierra en el fin
// de su última llamada; si llega una llamada que el engine no agrupa con él,
// deja de ser la última del agente y también se cierra.
function awaitsAnotherCall(calls: readonly ToolGroupCall[]): boolean {
  const ids = new Set(calls.map((c) => c.tool_use_id));
  return [...lastCall.values()].some((id) => ids.has(id));
}

// ToolGroup: hora = inicio de la primera tool.call y cifra = tiempo hasta el
// fin de la última, con la generación del modelo entre llamadas incluida. Una
// sola magnitud en vivo y al terminar: mientras el grupo sigue abierto (alguna
// llamada en curso o `isRunning` aunque su tool.call no haya arrancado, o el
// modelo generando la siguiente: awaitsAnotherCall) cuenta hasta ahora
// (`counter`), avanzado por el reloj al cumplirse cada segundo
// (scheduleClock); al cerrarse, el fin de la última sale de las
// entradas `r:` y se guarda bajo `g:` (el grupo puede crecer: se recalcula y
// se vuelve a guardar si cambia). Sin entradas `r:` (fuera de la retención
// del store), lo guardado bajo `g:`. `toSave` pide a withTimestamp
// persistir la clave recalculada.
function group(
  calls: readonly ToolGroupCall[],
  isActive: boolean | undefined,
): Resolved {
  const blockKey = `g:${calls[0]!.tool_use_id}`;
  const now = Date.now();
  const rs = calls.map((c) => blocks.get(`r:${c.tool_use_id}`));
  if (
    calls.some((c) => c.isRunning || runningCalls.has(c.tool_use_id!)) ||
    (isActive !== false && awaitsAnotherCall(calls))
  ) {
    const starts = calls
      .map(
        (c, i) =>
          runningCalls.get(c.tool_use_id!) ??
          (rs[i]?.duration !== undefined ? rs[i].time : undefined),
      )
      .filter((h) => h !== undefined);
    const time = starts.length ? Math.min(...starts) : entryFor(blockKey).time;
    counters.set(blockKey, { start: time, seen: now });
    return { time, counter: now - time, subscribed: true };
  }
  counters.delete(blockKey);
  if (!rs.every((r) => r?.duration !== undefined)) return entryFor(blockKey);
  const time = Math.min(...rs.map((r) => r!.time));
  const duration = Math.max(...rs.map((r) => r!.time + r!.duration!)) - time;
  const g = blocks.get(blockKey);
  if (g?.time === time && g.duration === duration) return g;
  blocks.set(blockKey, { time, duration, fromEvent: true });
  return { time, duration, toSave: blockKey };
}

// Por componente: `{ time, duration?, icon }` leídos de lo fijado (claves:
// requestId en UserMessage, AssistantMessage y CommandOutput, que es el uuid
// de su fila; `u:` / `r:` / `g:` + tool_use_id en ToolUse, ToolResult y
// ToolGroup, cuyo requestId cambia a mitad de vida). Casos especiales:
// `unwrapped` (ToolUse de AskUserQuestion; ToolUse y ToolResult de
// SubagentHandback, que el engine dibuja vacíos), `dialog` (AskUserQuestion)
// y `noMargin` (componentes sin margen superior propio).
const NO_CONTENT = new Set(["SubagentHandback"]);

export const RESOLVER: {
  [C in TranscriptComponent]: (e: Frozen<RenderInput<C>>) => Resolved;
} = {
  // 🔌 prompt.submit → turn.start (hooks UserPromptSubmit); hora = envío.
  // Sin turno aún (placeholder), la hora de envío pendiente. Notificaciones
  // de tareas u otros orígenes no humanos solo muestran su hora de creación.
  UserMessage: (e) => {
    if (e.requestId === "placeholder")
      return { time: session.pendingSubmit ?? Date.now() };
    if (!isUserOrigin(e.props.origin))
      return { time: entryFor(e.requestId).time };
    return { ...entryFor(e.requestId), icon: "🔌" };
  },
  // 🧠 generación del bloque de texto, thinking previo incluido. En ctrl+o
  // no trae margen superior propio.
  AssistantMessage: (e) => ({
    ...entryFor(e.requestId),
    icon: "🧠",
    noMargin: session.expandedView,
    subscribed: blocks.get(e.requestId)?.duration === undefined,
  }),
  // 🧠 escritura de la llamada; la fija onToolCall al arrancar tool.call.
  // Mientras su llamada corre, `counter` es el tiempo desde el inicio de
  // tool.call y el footer añade `🔧 n s…` a la cifra 🧠; `subscribed` mantiene la instancia
  // atenta al reloj hasta que tool.call termina (r: con duración), también
  // antes de que arranque.
  ToolUse: (e) =>
    e.props.tool === "AskUserQuestion" || NO_CONTENT.has(e.props.tool)
      ? { unwrapped: true }
      : {
          ...entryFor(`u:${e.props.tool_use_id}`),
          icon: "🧠",
          counter: runningCalls.has(e.props.tool_use_id)
            ? Date.now() - runningCalls.get(e.props.tool_use_id)!
            : undefined,
          subscribed:
            blocks.get(`r:${e.props.tool_use_id}`)?.duration === undefined,
        },
  // 🔧 intervalo de tool.call (permiso incluido), fijado al terminar; 👤 en
  // AskUserQuestion. El de Agent no trae margen superior propio.
  ToolResult: (e) =>
    NO_CONTENT.has(e.props.tool)
      ? { unwrapped: true }
      : {
          ...entryFor(`r:${e.props.tool_use_id}`),
          icon: e.props.tool === "AskUserQuestion" ? "👤" : "🔧",
          noMargin: e.props.tool === "Agent",
        },
  // 🔧 inicio de la primera tool.call hasta el fin de la última.
  ToolGroup: (e) => ({ ...group(e.props.calls, e.props.isActive), icon: "🔧" }),
  // 🔧 intervalo de command.run. Su salida no trae margen superior propio.
  CommandOutput: (e) => ({
    ...entryFor(e.requestId),
    icon: "🔧",
    noMargin: true,
  }),
  // Diálogo: solo header, con el inicio de su tool.call; va en flujo y sin
  // recuadro porque el engine rechaza `position` alrededor del diálogo.
  AskUserQuestion: (e) => ({
    time: runningCalls.get(e.requestId) ?? entryFor(`r:${e.requestId}`).time,
    dialog: true,
  }),
};
