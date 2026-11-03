import {
  MAIN,
  agentOf,
  isUserOrigin,
  lastCall,
  runningCalls,
  session,
  taskRegistry,
  turns,
} from "./session.js";
import { pinTiming } from "./timing-store.js";
import { scheduleClock } from "./live-clock.js";

// ── Hooks de ciclo de vida ──────────────────────────────────────────────────
//
// Fijan hora y duración de cada bloque en el evento que las produce, para
// todos los agentes (principal y subagentes), nunca desde la cadencia de
// renders. Los registros de abajo guardan solo lo que aún no se ha fijado:
// lo consumido se borra y lo que sobra se poda por antigüedad. Son de
// observación y fail-open: no modifican `e`, chunks ni resultados, y si
// fallan el engine los salta y el turno sigue igual.

// Lo no consumido de más de PRUNE_MS se descarta.
const PRUNE_MS = 3_600_000;

// Filas de `session.append` que se dibujan como componente del transcript y
// por tanto se fijan y persisten; el resto (adjuntos, contexto de hooks…) se
// ignora.
const DRAWN_DOORS = new Set([
  "prompt",
  "delivery",
  "response",
  "command",
  "notice",
]);

// Prompt principal en curso: `{ submittedAt, rowKey?, turnStart? }` desde prompt.submit
// hasta que su fila (rowKey) y turn.start (turnStart) hayan llegado.
let currentPrompt;
// Content blocks `text` y `tool` del modelo aún sin consumir, por agente.
const modelBlocks = new Map();

// Slash commands terminados sin fila de salida: `{ command, start, end }`.
let commands = [];
// Comando cuya fila eco ya llegó, a la espera de su fila de salida.
let commandAwaitingOutput;

// Descarta los bloques del modelo y comandos no consumidos de más de PRUNE_MS.
function prune() {
  const cutoff = Date.now() - PRUNE_MS;
  for (const [agent, list] of modelBlocks) {
    const alive = list.filter((b) => b.last >= cutoff);
    if (alive.length) modelBlocks.set(agent, alive);
    else modelBlocks.delete(agent);
  }
  commands = commands.filter((c) => c.end >= cutoff);
}

export async function onSubmit($, e, next) {
  if (isUserOrigin(e.origin)) {
    session.pendingSubmit = Date.now();
    currentPrompt = { submittedAt: session.pendingSubmit };
  }
  return next(e);
}

// 🔌 de un UserMessage: prompt.submit → turn.start. Lo fija el último en
// llegar de su fila y turn.start; la hora (envío) se fija ya con la fila.
function completePrompt($) {
  const { submittedAt, rowKey, turnStart } = currentPrompt;
  if (rowKey === undefined) return;
  pinTiming($, rowKey, {
    time: submittedAt,
    duration: turnStart === undefined ? undefined : turnStart - submittedAt,
    persist: true,
  });
  if (turnStart !== undefined) currentPrompt = undefined;
}

export async function onTurnStart($, e, next) {
  const now = Date.now();
  turns.set(MAIN, { turnId: e.turnId, start: now });
  session.pendingSubmit = undefined;
  if (currentPrompt) {
    currentPrompt.turnStart = now;
    const drawn = currentPrompt.rowKey !== undefined;
    completePrompt($);
    // Su UserMessage ya se dibujó con la fila y el engine no lo redibuja
    // solo: se pide un redibujado para que muestre el 🔌 recién fijado.
    if (drawn) $.ui.invalidate("ui.render");
  }
  return next(e);
}

export async function onTurnComplete($, e, next) {
  turns.delete(agentOf(e));
  lastCall.delete(agentOf(e));
  // Cierra el ToolGroup que seguía abierto esperando otra llamada.
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, Date.now());
  return next(e);
}

const BLOCK_KINDS = new Set(["text", "thinking", "tool", "input"]);

// Registra cada content block de la respuesta con su primer y último chunk,
// en el registro de su agente. `attributedStart` es el fin del bloque visible
// anterior del mismo paso (o el inicio del paso): así el thinking previo
// cuenta en el bloque que sigue. Un subagente no emite turn.start: su turno
// empieza con el primer paso de un turnId nuevo.
export async function* onStep($, e, next) {
  const agent = agentOf(e);
  const stepStart = Date.now();
  if (turns.get(agent)?.turnId !== e.turnId)
    turns.set(agent, { turnId: e.turnId, start: stepStart });
  const byIndex = new Map();
  let previous;
  const stream = next(e)[Symbol.asyncIterator]();
  for (;;) {
    const { value: chunk, done } = await stream.next();
    if (done) {
      prune();
      return chunk;
    }
    if (BLOCK_KINDS.has(chunk.kind)) {
      const now = Date.now();
      let b = byIndex.get(chunk.index);
      if (!b) {
        b = {
          kind: chunk.kind,
          text: "",
          first: now,
          last: now,
          attributedStart: previous?.last ?? stepStart,
          visible: false,
        };
        byIndex.set(chunk.index, b);
        if (b.kind === "tool") {
          b.visible = true;
          previous = b;
          // La lista se crea aquí y no al empezar el paso: prune() borra
          // las listas vacías, también las de pasos de otros agentes en curso.
          if (!modelBlocks.has(agent)) modelBlocks.set(agent, []);
          modelBlocks.get(agent).push(b);
        }
      }
      if (b.kind === "text" && !b.visible) {
        if (previous?.kind === "thinking") {
          b.attributedStart = previous.attributedStart;
          const list = modelBlocks.get(agent);
          const idx = list ? list.indexOf(previous) : -1;
          if (idx >= 0) list.splice(idx, 1);
        }
        b.visible = true;
        previous = b;
        // Un bloque de texto cierra el ToolGroup abierto de su agente.
        lastCall.delete(agent);
        void $.state.set({ plugin: "evolutivex-agents", key: "second" }, now);
        if (!modelBlocks.has(agent)) modelBlocks.set(agent, []);
        modelBlocks.get(agent).push(b);
      } else if (b.kind === "thinking" && !b.visible && chunk.text.trim()) {
        b.visible = true;
        b.attributedStart = previous?.last ?? stepStart;
        previous = b;
        // Un bloque thinking de narración (adaptive thinking) también cierra
        // el ToolGroup abierto de su agente y se dibuja como AssistantMessage.
        lastCall.delete(agent);
        void $.state.set({ plugin: "evolutivex-agents", key: "second" }, now);
        if (!modelBlocks.has(agent)) modelBlocks.set(agent, []);
        modelBlocks.get(agent).push(b);
      }
      b.last = now;
      if (chunk.kind === "tool") b.toolId = chunk.id;
      if (chunk.kind === "text" || chunk.kind === "thinking")
        b.text += chunk.text;
    }
    yield chunk;
  }
}

// Saca del registro de `agent` el primer bloque que cumpla `predicate`.
function consumeBlock(agent, predicate) {
  const list = modelBlocks.get(agent);
  const i = list?.findIndex(predicate) ?? -1;
  return i < 0 ? undefined : list.splice(i, 1)[0];
}

// Fija el ToolUse al arrancar (🧠 escritura de la llamada: el bloque del
// modelo ya está cerrado) y el ToolResult al terminar (🔧 ejecución, permiso
// incluido), en cualquier agente. Al arrancar y al terminar escribe `second`
// una vez para que el contador 🔧 del ToolUse aparezca y se retire en el
// momento, sin esperar al tic siguiente.
export async function onToolCall($, e, next) {
  const start = Date.now();
  runningCalls.set(e.tool_use_id, start);
  lastCall.set(agentOf(e), e.tool_use_id);
  scheduleClock($);
  const b = consumeBlock(agentOf(e), (b) => b.toolId === e.tool_use_id);
  if (b)
    pinTiming($, `u:${e.tool_use_id}`, {
      time: b.attributedStart,
      duration: b.last - b.attributedStart,
      persist: true,
    });
  if (e.tool === "TodoWrite" && Array.isArray(e.input?.todos)) {
    const active = e.input.todos.find((t) => t?.status === "in_progress");
    session.todoActiveLabel = active
      ? (active.activeForm ?? active.content)
      : undefined;
  } else if (e.tool === "TaskUpdate" && e.input?.taskId !== undefined) {
    const id = String(e.input.taskId);
    const prev = taskRegistry.get(id) ?? {};
    const label = e.input.activeForm ?? e.input.subject ?? prev.label;
    const status = e.input.status ?? prev.status;
    if (status === "deleted") taskRegistry.delete(id);
    else taskRegistry.set(id, { label, status });
  }
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, start);
  try {
    const out = await next(e);
    if (e.tool === "TaskCreate") {
      const id =
        out?.result?.task?.id ?? /^Task #(\S+)/.exec(out?.text ?? "")?.[1];
      if (id !== undefined) {
        taskRegistry.set(String(id), {
          label: e.input?.activeForm ?? e.input?.subject,
          status: e.input?.status ?? "pending",
        });
      }
    }
    return out;
  } finally {
    runningCalls.delete(e.tool_use_id);
    pinTiming($, `r:${e.tool_use_id}`, {
      time: start,
      duration: Date.now() - start,
      persist: true,
    });
    void $.state.set(
      { plugin: "evolutivex-agents", key: "second" },
      Date.now(),
    );
  }
}

export async function onCommandRun($, e, next) {
  const start = Date.now();
  try {
    return await next(e);
  } finally {
    commands.push({ command: e.command, start, end: Date.now() });
    prune();
  }
}

const textOf = (message) =>
  message.content
    .map((b) =>
      b.type === "text"
        ? (b.text ?? "")
        : b.type === "thinking"
          ? (b.thinking ?? "")
          : "",
    )
    .join("");

// Fija cada fila dibujada del transcript bajo su uuid (el requestId de su
// componente), antes de `next`, porque el engine puede dibujarla mientras se
// guarda:
//   prompt principal  hora = envío; el 🔌 lo completa turn.start
//   response con texto  hora y 🧠 de su bloque de texto o narración, que se consume
//   command stdout  hora y 🔧 del comando nombrado en la fila eco anterior
//   resto (prompt de subagente o notificación, delivery, turn_duration)
//     hora = la de la fila, sin duración
export async function onAppend($, e, next) {
  if (!DRAWN_DOORS.has(e.door)) return next(e);
  const now = Date.now();
  const text = textOf(e.message);
  const row = { time: now, persist: true };
  switch (e.door) {
    case "prompt":
      if (
        !e.agentId &&
        isUserOrigin(e.origin) &&
        currentPrompt &&
        currentPrompt.rowKey === undefined
      ) {
        currentPrompt.rowKey = e.uuid;
        completePrompt($);
      } else {
        pinTiming($, e.uuid, row);
      }
      break;
    case "response": {
      if (!text.trim()) break;
      lastCall.delete(agentOf(e));
      const b = consumeBlock(
        agentOf(e),
        (b) =>
          (b.kind === "text" || b.kind === "thinking") &&
          b.text.trim() === text.trim(),
      );
      pinTiming(
        $,
        e.uuid,
        b
          ? {
              time: b.attributedStart,
              duration: b.last - b.attributedStart,
              persist: true,
            }
          : row,
      );
      $.ui.invalidate("ui.render");
      void $.state.set({ plugin: "evolutivex-agents", key: "second" }, now);
      break;
    }
    case "command": {
      const name = /<command-name>\/?([^<]+)<\/command-name>/.exec(text)?.[1];
      if (name !== undefined) {
        const i = commands.findLastIndex((c) => c.command === name);
        commandAwaitingOutput = i < 0 ? undefined : commands.splice(i, 1)[0];
      } else if (/<local-command-std(out|err)>/.test(text)) {
        const c = commandAwaitingOutput;
        commandAwaitingOutput = undefined;
        pinTiming(
          $,
          e.uuid,
          c ? { time: c.start, duration: c.end - c.start, persist: true } : row,
        );
      }
      break;
    }
    case "notice":
      if (e.message.name === "turn_duration") pinTiming($, e.uuid, row);
      break;
    default:
      pinTiming($, e.uuid, row);
  }
  return next(e);
}
