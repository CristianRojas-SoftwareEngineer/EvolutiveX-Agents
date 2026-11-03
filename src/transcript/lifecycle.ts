import type {
  EngineInterface,
  Hook,
  ToolResultOf,
  TurnStepChunk,
  TurnStepInputChunk,
  TurnStepTextChunk,
  TurnStepThinkingChunk,
  TurnStepToolChunk,
} from "claude-code";
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
let currentPrompt:
  { submittedAt: number; rowKey?: string; turnStart?: number } | undefined;
// Content blocks `text` y `tool` del modelo aún sin consumir, por agente.
const modelBlocks = new Map<string, ModelBlock[]>();

// Content block de la respuesta: tipo, texto acumulado, primer y último chunk
// (epoch ms), inicio atribuido, si ya se dibuja y, en `tool`, su tool_use_id.
type ModelBlock = {
  kind: string;
  text: string;
  first: number;
  last: number;
  attributedStart: number;
  visible: boolean;
  toolId?: string;
};

// Slash command terminado: nombre e intervalo de command.run (epoch ms).
type CommandRun = { command: string; start: number; end: number };

// Slash commands terminados sin fila de salida: `{ command, start, end }`.
let commands: CommandRun[] = [];
// Comando cuya fila eco ya llegó, a la espera de su fila de salida.
let commandAwaitingOutput: CommandRun | undefined;

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

export async function onSubmit(
  $: EngineInterface,
  e: Parameters<Hook<"prompt.submit">>[1],
  next: Parameters<Hook<"prompt.submit">>[2],
) {
  if (isUserOrigin(e.origin)) {
    session.pendingSubmit = Date.now();
    currentPrompt = { submittedAt: session.pendingSubmit };
  }
  return next(e);
}

// 🔌 de un UserMessage: prompt.submit → turn.start. Lo fija el último en
// llegar de su fila y turn.start; la hora (envío) se fija ya con la fila.
function completePrompt($: EngineInterface): void {
  const { submittedAt, rowKey, turnStart } = currentPrompt!;
  if (rowKey === undefined) return;
  pinTiming($, rowKey, {
    time: submittedAt,
    duration: turnStart === undefined ? undefined : turnStart - submittedAt,
    persist: true,
  });
  if (turnStart !== undefined) currentPrompt = undefined;
}

export async function onTurnStart(
  $: EngineInterface,
  e: Parameters<Hook<"turn.start">>[1],
  next: Parameters<Hook<"turn.start">>[2],
) {
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

export async function onTurnComplete(
  $: EngineInterface,
  e: Parameters<Hook<"turn.complete">>[1],
  next: Parameters<Hook<"turn.complete">>[2],
) {
  turns.delete(agentOf(e));
  lastCall.delete(agentOf(e));
  // Cierra el ToolGroup que seguía abierto esperando otra llamada.
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, Date.now());
  return next(e);
}

const BLOCK_KINDS = new Set(["text", "thinking", "tool", "input"]);

// Chunks de content block (los que trae BLOCK_KINDS), con su `index`.
type BlockChunk =
  | TurnStepTextChunk
  | TurnStepThinkingChunk
  | TurnStepToolChunk
  | TurnStepInputChunk;
const isBlockChunk = (chunk: TurnStepChunk): chunk is BlockChunk =>
  BLOCK_KINDS.has(chunk.kind);

// Paso en curso de un agente: su inicio, sus bloques por índice y el último
// bloque visible, del que el siguiente toma su inicio atribuido.
type StepState = {
  agent: string;
  start: number;
  byIndex: Map<number, ModelBlock>;
  previous?: ModelBlock;
};

// Añade un bloque visible al registro de su agente. La lista se crea aquí y
// no al empezar el paso: prune() borra las listas vacías, también las de
// pasos de otros agentes en curso.
function registerBlock(agent: string, b: ModelBlock): void {
  if (!modelBlocks.has(agent)) modelBlocks.set(agent, []);
  modelBlocks.get(agent)!.push(b);
}

// Saca `b` del registro de su agente, si sigue ahí.
function unregisterBlock(agent: string, b: ModelBlock): void {
  const list = modelBlocks.get(agent);
  const idx = list ? list.indexOf(b) : -1;
  if (idx >= 0) list!.splice(idx, 1);
}

// Hace visible `b` como el último bloque visible del paso y lo registra.
function reveal(step: StepState, b: ModelBlock): void {
  b.visible = true;
  step.previous = b;
  registerBlock(step.agent, b);
}

// Bloque del índice del chunk, dado de alta con su primer chunk. Un bloque
// `tool` es visible desde ese primer chunk.
function blockFor(step: StepState, chunk: BlockChunk, now: number): ModelBlock {
  let b = step.byIndex.get(chunk.index);
  if (b) return b;
  b = {
    kind: chunk.kind,
    text: "",
    first: now,
    last: now,
    attributedStart: step.previous?.last ?? step.start,
    visible: false,
  };
  step.byIndex.set(chunk.index, b);
  if (b.kind === "tool") reveal(step, b);
  return b;
}

// Un bloque `text` se hace visible con su primer chunk y absorbe el thinking
// que lo precede (su inicio atribuido pasa a ser el de ese thinking); uno
// `thinking`, con su primer chunk no vacío (narración de adaptive thinking,
// que se dibuja como AssistantMessage). Ambos cierran el ToolGroup abierto de
// su agente.
function updateVisibility(
  $: EngineInterface,
  step: StepState,
  b: ModelBlock,
  chunk: BlockChunk,
  now: number,
): void {
  if (b.visible) return;
  if (b.kind === "text") {
    const previous = step.previous;
    if (previous?.kind === "thinking") {
      b.attributedStart = previous.attributedStart;
      unregisterBlock(step.agent, previous);
    }
  } else if (
    b.kind === "thinking" &&
    chunk.kind === "thinking" &&
    chunk.text.trim()
  ) {
    b.attributedStart = step.previous?.last ?? step.start;
  } else {
    return;
  }
  reveal(step, b);
  lastCall.delete(step.agent);
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, now);
}

// Contabilidad de un chunk de content block: alta de su bloque, visibilidad,
// último chunk y texto acumulado.
function accountChunk(
  $: EngineInterface,
  step: StepState,
  chunk: BlockChunk,
): void {
  const now = Date.now();
  const b = blockFor(step, chunk, now);
  updateVisibility($, step, b, chunk, now);
  b.last = now;
  if (chunk.kind === "tool") b.toolId = chunk.id;
  if (chunk.kind === "text" || chunk.kind === "thinking") b.text += chunk.text;
}

// Registra cada content block de la respuesta con su primer y último chunk,
// en el registro de su agente. `attributedStart` es el fin del bloque visible
// anterior del mismo paso (o el inicio del paso): así el thinking previo
// cuenta en el bloque que sigue. Un subagente no emite turn.start: su turno
// empieza con el primer paso de un turnId nuevo.
export async function* onStep(
  $: EngineInterface,
  e: Parameters<Hook<"turn.step">>[1],
  next: Parameters<Hook<"turn.step">>[2],
) {
  const agent = agentOf(e);
  const start = Date.now();
  if (turns.get(agent)?.turnId !== e.turnId)
    turns.set(agent, { turnId: e.turnId, start });
  const step: StepState = { agent, start, byIndex: new Map() };
  const stream = next(e)[Symbol.asyncIterator]();
  for (;;) {
    const { value: chunk, done } = await stream.next();
    if (done) {
      prune();
      return chunk;
    }
    if (isBlockChunk(chunk)) accountChunk($, step, chunk);
    yield chunk;
  }
}

// Saca del registro de `agent` el primer bloque que cumpla `predicate`.
function consumeBlock(
  agent: string,
  predicate: (b: ModelBlock) => boolean,
): ModelBlock | undefined {
  const list = modelBlocks.get(agent);
  const i = list?.findIndex(predicate) ?? -1;
  return i < 0 ? undefined : list!.splice(i, 1)[0];
}

// Fija el ToolUse al arrancar (🧠 escritura de la llamada: el bloque del
// modelo ya está cerrado) y el ToolResult al terminar (🔧 ejecución, permiso
// incluido), en cualquier agente. Al arrancar y al terminar escribe `second`
// una vez para que el contador 🔧 del ToolUse aparezca y se retire en el
// momento, sin esperar al tic siguiente.
export async function onToolCall(
  $: EngineInterface,
  e: Parameters<Hook<"tool.call">>[1],
  next: Parameters<Hook<"tool.call">>[2],
) {
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
  if (e.tool === "TodoWrite" && Array.isArray(e.todos)) {
    const active = e.todos.find((t) => t.status === "in_progress");
    session.todoActiveLabel = active
      ? (active.activeForm ?? active.content)
      : undefined;
  } else if (e.tool === "TaskUpdate" && e.taskId !== undefined) {
    const id = String(e.taskId);
    const prev = taskRegistry.get(id) ?? {};
    const label = e.activeForm ?? e.subject ?? prev.label;
    const status = e.status ?? prev.status;
    if (status === "deleted") taskRegistry.delete(id);
    else taskRegistry.set(id, { label, status });
  }
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, start);
  try {
    const out = await next(e);
    if (e.tool === "TaskCreate") {
      const id =
        (out?.result as ToolResultOf<"TaskCreate"> | undefined)?.task?.id ??
        /^Task #(\S+)/.exec(out?.text ?? "")?.[1];
      if (id !== undefined) {
        taskRegistry.set(String(id), {
          label: e.activeForm ?? e.subject,
          status: "pending",
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

export async function onCommandRun(
  $: EngineInterface,
  e: Parameters<Hook<"command.run">>[1],
  next: Parameters<Hook<"command.run">>[2],
) {
  const start = Date.now();
  try {
    return await next(e);
  } finally {
    commands.push({ command: e.command, start, end: Date.now() });
    prune();
  }
}

const textOf = (message: Parameters<Hook<"session.append">>[1]["message"]) =>
  message.content
    .map((b) =>
      b.type === "text"
        ? (b.text ?? "")
        : b.type === "thinking"
          ? (b.thinking ?? "")
          : "",
    )
    .join("");

type AppendEvent = Parameters<Hook<"session.append">>[1];
// Hora de la fila, sin duración, persistida.
type RowTiming = { time: number; persist: true };

// prompt: el principal del usuario completa su UserMessage (hora = envío; el
// 🔌 lo completa turn.start); el resto (subagente, notificación) lleva la hora
// de la fila.
function appendPrompt($: EngineInterface, e: AppendEvent, row: RowTiming) {
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
}

// response con texto: hora y 🧠 de su bloque de texto o narración, que se
// consume; cierra el ToolGroup abierto de su agente.
function appendResponse(
  $: EngineInterface,
  e: AppendEvent,
  text: string,
  row: RowTiming,
) {
  if (!text.trim()) return;
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
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, row.time);
}

// command: la fila eco nombra el comando terminado; la de su stdout/stderr
// lleva su hora y su 🔧.
function appendCommand(
  $: EngineInterface,
  e: AppendEvent,
  text: string,
  row: RowTiming,
) {
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
}

// Fija cada fila dibujada del transcript bajo su uuid (el requestId de su
// componente), antes de `next`, porque el engine puede dibujarla mientras se
// guarda:
//   prompt principal  hora = envío; el 🔌 lo completa turn.start
//   response con texto  hora y 🧠 de su bloque de texto o narración, que se consume
//   command stdout  hora y 🔧 del comando nombrado en la fila eco anterior
//   resto (prompt de subagente o notificación, delivery, turn_duration)
//     hora = la de la fila, sin duración
export async function onAppend(
  $: EngineInterface,
  e: AppendEvent,
  next: Parameters<Hook<"session.append">>[2],
) {
  if (!DRAWN_DOORS.has(e.door)) return next(e);
  const text = textOf(e.message);
  const row: RowTiming = { time: Date.now(), persist: true };
  switch (e.door) {
    case "prompt":
      appendPrompt($, e, row);
      break;
    case "response":
      appendResponse($, e, text, row);
      break;
    case "command":
      appendCommand($, e, text, row);
      break;
    case "notice":
      if (e.message.name === "turn_duration") pinTiming($, e.uuid, row);
      break;
    default:
      pinTiming($, e.uuid, row);
  }
  return next(e);
}
