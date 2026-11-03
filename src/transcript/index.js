// ─────────────────────────────────────────────────────────────────────────────
// Transcript enriquecido de EvolutiveX Agents
//
// Añade una marca de tiempo (h:mm:ss a.m. / p.m.) con icono 🕐 dentro de un
// recuadro box-drawing sobre cada render site del transcript: UserMessage,
// AssistantMessage, ToolUse, ToolResult, ToolGroup, CommandOutput,
// AskUserQuestion, Spinner y TurnDuration.
//
// Estrategia unificada (tree-wrapping):
//
//   Todos los componentes del transcript pasan por el mismo handler
//   `withTimestamp` (sin distinción entre componentes con o sin prop `text`).
//   Se llama a `next(e)` para obtener el árbol RenderElement del engine
//   (`{ type: 'engine', ref: 0 }`), y se envuelve en un Box exterior sin
//   borde (`flexDirection: 'column', paddingTop: 1, flexGrow: 1`) que contiene:
//     1. Un Box `column-reverse` con:
//        a) Un Box con borderStyle: 'round' que envuelve el árbol del engine,
//           dentro de un Box con marginTop: -1 que absorbe el margen superior
//           propio del engine (si no, queda una fila vacía bajo el header)
//           y de un espaciador de alto 0 (`e.viewport?.columns - 2`) que fija
//           el ancho del recuadro al 100% del viewport incluso cuando un
//           ToolGroup desmonta su subfila activa
//        b) Una fila en flujo (marginBottom: -1) con el Text del header, que
//           se superpone sobre el borde superior:  ╭─ 🕐 hora | ComponentType ─╮
//     2. Cuando su dato es definitivo, una fila en flujo (marginTop: -1,
//        marginLeft: 2, marginRight: 2, justifyContent: 'flex-end') sin
//        `position: 'absolute'`, con la duración del trabajo alineada a la
//        derecha sobre el borde inferior:  ╰──── 🔧 1m 05s ─╯
//
//   Regla de hora: el header muestra el inicio del trabajo que mide el
//   footer (header + footer = fin). Footer por tipo, con el icono de quien
//   hizo el trabajo (🧠 modelo, 🔧 herramienta o comando, 👤 usuario, 🔌 hooks):
//     UserMessage       🔌  prompt.submit → turn.start (hooks UserPromptSubmit,
//                           solo para origin.kind === 'composer' | 'bridge')
//     AssistantMessage  🧠  generación del bloque de texto o narración en
//                           adaptive thinking, thinking previo incluido
//     ToolUse           🧠  escritura de la llamada por el modelo; mientras su
//                           tool.call corre, añade `· 🔧 n s…` (counter de
//                           ejecución, que comparte con el ToolGroup el reloj
//                           de scheduleClock) y al terminar vuelve a solo 🧠
//     ToolResult        🔧  intervalo de tool.call (permiso incluido); 👤 en AskUserQuestion
//     ToolGroup         🔧  desde el inicio de su primera tool.call hasta el fin
//                           de la última, con la generación del modelo entre
//                           llamadas incluida (header + footer = fin);
//                           mientras el grupo sigue abierto, un contador que avanza cada segundo
//                           (`$.state` evolutivex-agents.second, declarado en
//                           types/index.d.ts)
//     CommandOutput     🔧  intervalo de command.run
//   Las filas sin trabajo medido (notificaciones, mensajes de otros agentes,
//   prompt inicial de un subagente) llevan la hora en que se crearon.
//
//   Fijación por evento: toda hora y duración se fija en el evento que la
//   produce, nunca en el render, y una vez fijada no cambia. Las filas del
//   transcript (UserMessage, AssistantMessage, CommandOutput, TurnDuration)
//   se fijan en session.append bajo su uuid, que es el requestId de su
//   componente; las llamadas en tool.call; los bloques del modelo se
//   registran en turn.step y los turnos en turn.start / turn.step /
//   turn.complete. Todo se registra por agente, también en subagentes, y lo
//   no consumido se poda tras una hora.
//
//   Vistas tardías: un bloque que se dibuja más tarde (grupo expandido,
//   ctrl+o, vista de un subagente en curso, terminado o en segundo plano,
//   sesión reanudada) solo lee lo fijado y muestra las mismas cifras que la
//   vista en vivo. La vista ctrl+o se deduce de `isExpanded` en mensajes de
//   usuario reales, ToolResult y TurnDuration: en ella AssistantMessage no
//   trae margen superior propio.
//
//   Horas y duraciones se persisten en `$.store` (un bucket por día, 30 días
//   de retención y presupuesto máximo MAX_STORE_BYTES = 3.5 MiB con poda FIFO
//   de los días más antiguos), solo para las filas que se dibujan como
//   componente (DRAWN_DOORS) y las claves de llamadas, así que una sesión
//   reanudada (--continue / --resume) muestra las mismas que la original.
//
//   Ni el header ni el footer pueden ir dentro del Box con borde (ahí lo que
//   cae sobre la fila del borde no se pinta) ni usar `position: 'absolute'`
//   (que induce `overflow: 'hidden'` en el motor). Ambos van en flujo: el
//   header en un Box `column-reverse` con marginBottom: -1 sobre `╭───╮` y el
//   footer en el Box `column` exterior con marginTop: -1 sobre `╰───╯`. Al ir
//   en flujo, el scroll los recorta sin reubicarlos ni dejar residuos.
//
//   El marco (╭─╮ │ ╰─╯) lo dibuja borderStyle al ancho del viewport gracias
//   a `flexGrow: 1` en el Box exterior y al espaciador de alto 0 dimensionado
//   a `e.viewport?.columns - 2` (un Text de espacios con wrap: 'truncate' en
//   un Box height: 0). Si el viewport es más angosto que header o footer,
//   ambos se truncan con `…`.
//
//   AskUserQuestion es la excepción: su ToolUse se dibuja vacío mientras
//   espera, así que se deja sin envolver; y el engine rechaza `position`
//   alrededor del diálogo, así que este lleva solo el header, en flujo y sin
//   recuadro ni footer (su espera la mide el 👤 del ToolResult).
//
//   NOTA: No se usa la prop `width` en el Box — el render engine rechaza
//   "engine node under a Box with prop width", cayendo al rendering original
//   sin el timestamp. Con borderStyle, flexGrow: 1 y el espaciador height: 0
//   sin width, el Box ocupa todo el ancho del viewport (incluyendo ToolGroup
//   dentro de contenedores flexDirection: 'row'), generando líneas verticales │
//   en los laterales de forma invariante. borderStyle: 'round' es aceptado y
//   funciona correctamente.
//
//   Spinner y TurnDuration usan handlers dedicados (withSpinner,
//   withTurnDuration) que modifican props.word y props.message directamente,
//   ya que no necesitan tree-wrapping: el Spinner muestra el inicio del
//   turno en curso de su agente (sin persistir, conservándolo incluso cuando
//   hay tareas in_progress) y TurnDuration el fin del turno (persistido).
//
// Activación: opt-in, con `enhancedTranscript` en /config
// (evolutivex-agents.enhancedTranscript, desactivado por defecto).
//
// Requiere Claude Code v2.1.287 o posterior (function hooks habilitados).
// ─────────────────────────────────────────────────────────────────────────────

// Formatea un instante (epoch ms) en formato 12h con a.m. / p.m.
// 0h → 12 a.m., 13h → 1 p.m., 12h → 12 p.m.
function formatClockTime(ms) {
  const date = new Date(ms);
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const suffix = h >= 12 ? "p.m." : "a.m.";
  h = h % 12 || 12; // 0 -> 12, 13 -> 1
  return `${h}:${m}:${s} ${suffix}`;
}

const pad2 = (n) => String(n).padStart(2, "0");

// ── Registro de bloques y persistencia ──────────────────────────────────────
//
// Cada bloque del transcript tiene una clave estable (ver RESOLVER) y una
// entrada `{ time, duration?, fromEvent? }` en ms. Hora y duración las fija el
// evento que las produce (`pinTiming`, marca `fromEvent`); el render solo crea una
// entrada con su propia hora cuando no hay ninguna (bloques sin evento de
// origen), y un evento posterior la corrige. Las entradas persistidas viven
// en `$.store` agrupadas por día local (`days/AAAA-MM-DD` → `{ [blockKey]: { h, d? } }`)
// para que una sesión reanudada muestre las mismas horas y footers; los días
// con más de RETENTION_DAYS o que hagan superar el presupuesto MAX_STORE_BYTES
// (3.5 MiB, bajo el límite duro de 4 MiB del motor) se desalojan en orden FIFO.

const RETENTION_DAYS = 30;
const MAX_STORE_BYTES = 3_670_016;
const DAY_PREFIX = "days/";

const blocks = new Map();
const dayBuckets = new Map();
let storeLoaded;
const pendingKeys = new Set();
let flushTimer;

const bucketBytes = (key, data) => key.length + JSON.stringify(data).length + 4;

// Desaloja en orden cronológico (FIFO) los buckets diarios más antiguos
// mientras el peso estimado del store supere MAX_STORE_BYTES (3.5 MiB).
async function enforceStoreBudget($, keepDay) {
  let total = 0;
  for (const b of dayBuckets.values()) total += b.bytes;
  while (total > MAX_STORE_BYTES) {
    const oldestKey = [...dayBuckets.keys()].sort().find((k) => k !== keepDay);
    if (!oldestKey) break;
    total -= dayBuckets.get(oldestKey).bytes;
    dayBuckets.delete(oldestKey);
    await $.store.delete(oldestKey);
  }
}

// Día local AAAA-MM-DD de un instante en epoch ms.
function dayOf(ms) {
  const f = new Date(ms);
  return `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}

// Carga el store una sola vez por carga del módulo: borra los días vencidos
// o que excedan el presupuesto de bytes y vuelca el resto en `blocks` sin
// pisar lo que ya haya en memoria.
function loadStore($) {
  storeLoaded ??= (async () => {
    const cutoff = dayOf(Date.now() - RETENTION_DAYS * 86_400_000);
    const dayKeys = (await $.store.keys())
      .filter((k) => k.startsWith(DAY_PREFIX))
      .sort();
    for (const key of dayKeys) {
      if (key.slice(DAY_PREFIX.length) < cutoff) {
        await $.store.delete(key);
        continue;
      }
      const data = (await $.store.get(key)) ?? {};
      dayBuckets.set(key, { data, bytes: bucketBytes(key, data) });
    }
    await enforceStoreBudget($);
    for (const { data } of dayBuckets.values()) {
      for (const [blockKey, { h, d }] of Object.entries(data)) {
        if (!blocks.has(blockKey) || !blocks.get(blockKey).fromEvent) {
          blocks.set(blockKey, { time: h, duration: d, fromEvent: true });
        }
      }
    }
  })();
  return storeLoaded;
}

// Devuelve la entrada de `blockKey`, creándola con la hora del render si no
// existe (bloque sin evento de origen). No se persiste: lo persistido sale
// siempre de un evento. Requiere el store ya cargado.
function entryFor(blockKey) {
  let b = blocks.get(blockKey);
  if (!b) {
    b = { time: Date.now() };
    blocks.set(blockKey, b);
  }
  return b;
}

// Fija hora y duración de un bloque desde el evento que las produce, en el
// momento en que ocurre: el bloque puede dibujarse mucho después (al expandir
// un ToolGroup, en ctrl+o, en la vista de un subagente). Corrige la hora de
// una entrada creada antes por un render; una entrada de evento no cambia de
// hora y su duración, una vez fijada, no se toca.
function pinTiming($, blockKey, { time, duration, persist }) {
  const b = blocks.get(blockKey);
  if (b?.fromEvent) {
    if (b.duration !== undefined || duration === undefined) return;
    b.duration = duration;
  } else {
    blocks.set(blockKey, { time, duration, fromEvent: true });
  }
  if (persist) void loadStore($).then(() => markForSave($, blockKey));
}

// Marca la clave para el próximo volcado, agrupando escrituras en un solo
// temporizador pendiente.
function markForSave($, blockKey) {
  pendingKeys.add(blockKey);
  flushTimer ??= $.clock.after(1000, () => flush($));
}

// Escribe las claves pendientes en el bucket del día de su hora. Relee cada
// bucket y lo fusiona antes de escribir, para no pisar otra sesión concurrente,
// garantizando que el store no supere MAX_STORE_BYTES.
async function flush($) {
  flushTimer = undefined;
  const byDay = new Map();
  for (const blockKey of pendingKeys) {
    const entry = blocks.get(blockKey);
    if (!entry) continue;
    const { time, duration } = entry;
    const day = DAY_PREFIX + dayOf(time);
    if (!byDay.has(day)) byDay.set(day, {});
    byDay.get(day)[blockKey] = { h: time, d: duration };
  }
  pendingKeys.clear();
  for (const [day, entries] of byDay) {
    const base = dayBuckets.get(day)?.data ?? (await $.store.get(day)) ?? {};
    const merged = { ...base, ...entries };
    dayBuckets.set(day, { data: merged, bytes: bucketBytes(day, merged) });
    await enforceStoreBudget($, day);
    try {
      await $.store.set(day, merged);
    } catch {
      const oldest = (await $.store.keys())
        .filter((k) => k.startsWith(DAY_PREFIX) && k !== day)
        .sort()[0];
      if (oldest) {
        dayBuckets.delete(oldest);
        await $.store.delete(oldest);
        try {
          await $.store.set(day, merged);
        } catch {
          // Sin espacio ni tras liberar el día más antiguo: se descarta este guardado.
        }
      }
    }
  }
}

// Formatea ms como `<0.1s`, `2.1s` (un decimal bajo 10 s), `45s`, `1m 05s`
// o `1h 02m 05s`.
function formatDuration(ms) {
  if (ms < 100) return "<0.1s";
  if (ms < 9950) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${pad2(m)}m ${pad2(s)}s`;
  if (m) return `${m}m ${pad2(s)}s`;
  return `${s}s`;
}

// Contador de un bloque en curso: segundos enteros y `…` (`7s…`, `1m 05s…`).
function formatRunning(ms) {
  const s = Math.floor(ms / 1000);
  return (s < 10 ? `${s}s` : formatDuration(s * 1000)) + "…";
}

// ── Hooks de ciclo de vida ──────────────────────────────────────────────────
//
// Fijan hora y duración de cada bloque en el evento que las produce, para
// todos los agentes (principal y subagentes), nunca desde la cadencia de
// renders. Los registros de abajo guardan solo lo que aún no se ha fijado:
// lo consumido se borra y lo que sobra se poda por antigüedad. Son de
// observación y fail-open: no modifican `e`, chunks ni resultados, y si
// fallan el engine los salta y el turno sigue igual.

// Agente de un evento: el subagente que lo emite, o el loop principal.
const MAIN = "main";
const agentOf = (e) => e.agentId ?? MAIN;
const isUserOrigin = (origin) =>
  origin?.kind === "composer" || origin?.kind === "bridge";

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

// Hora de envío del prompt aún sin turno (UserMessage con requestId placeholder).
let pendingSubmit;
// Prompt principal en curso: `{ submittedAt, rowKey?, turnStart? }` desde prompt.submit
// hasta que su fila (rowKey) y turn.start (turnStart) hayan llegado.
let currentPrompt;
// Content blocks `text` y `tool` del modelo aún sin consumir, por agente.
const modelBlocks = new Map();
// Inicio de cada tool.call en curso, por tool_use_id.
const runningCalls = new Map();
// ToolGroups con contador en vivo, por clave `g:`: `{ start, seen }`, con
// la hora de inicio del grupo y la del último dibujo (el contador del ToolUse
// sale de runningCalls).
const counters = new Map();
// Próximo tic del reloj de los contadores: `{ timer, at }` (epoch ms).
let clock;
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
function scheduleClock($) {
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
// Slash commands terminados sin fila de salida: `{ command, start, end }`.
let commands = [];
// Comando cuya fila eco ya llegó, a la espera de su fila de salida.
let commandAwaitingOutput;
// Turno en curso de cada agente: `{ turnId, start }`.
const turns = new Map();
// Última tool.call de cada agente mientras puede seguir una nueva: la borran
// el siguiente bloque de texto y el fin del turno. El ToolGroup que la
// contiene es la cola del agente y aún puede recibir llamadas.
const lastCall = new Map();
// Registro en sesión de tareas (TaskCreate / TaskUpdate / TodoWrite) para
// preservar el prefijo de hora en Spinner cuando props.message === null.
const taskRegistry = new Map();
let todoActiveLabel;
const getActiveTaskLabel = () =>
  todoActiveLabel ??
  [...taskRegistry.values()].find((t) => t.status === "in_progress" && t.label)
    ?.label ??
  null;

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

async function onSubmit($, e, next) {
  if (isUserOrigin(e.origin)) {
    pendingSubmit = Date.now();
    currentPrompt = { submittedAt: pendingSubmit };
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

async function onTurnStart($, e, next) {
  const now = Date.now();
  turns.set(MAIN, { turnId: e.turnId, start: now });
  pendingSubmit = undefined;
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

async function onTurnComplete($, e, next) {
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
async function* onStep($, e, next) {
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
async function onToolCall($, e, next) {
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
    todoActiveLabel = active
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

async function onCommandRun($, e, next) {
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
async function onAppend($, e, next) {
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

// ── Footers por componente ──────────────────────────────────────────────────

// Vista ctrl+o activa: al conmutarla, el engine redibuja todos los
// UserMessage (que traen `isExpanded`) antes que los AssistantMessage.
let expandedView = false;

// Un grupo cuya llamada es la última de su agente sigue abierto aunque todas
// hayan terminado: el modelo puede estar generando la siguiente. Es
// provisional: si llega texto o termina el turno, el grupo se cierra en el fin
// de su última llamada; si llega una llamada que el engine no agrupa con él,
// deja de ser la última del agente y también se cierra.
function awaitsAnotherCall(calls) {
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
function group(calls, isActive) {
  const blockKey = `g:${calls[0].tool_use_id}`;
  const now = Date.now();
  const rs = calls.map((c) => blocks.get(`r:${c.tool_use_id}`));
  if (
    calls.some((c) => c.isRunning || runningCalls.has(c.tool_use_id)) ||
    (isActive !== false && awaitsAnotherCall(calls))
  ) {
    const starts = calls
      .map(
        (c, i) =>
          runningCalls.get(c.tool_use_id) ??
          (rs[i]?.duration !== undefined ? rs[i].time : undefined),
      )
      .filter((h) => h !== undefined);
    const time = starts.length ? Math.min(...starts) : entryFor(blockKey).time;
    counters.set(blockKey, { start: time, seen: now });
    return { time, counter: now - time, subscribed: true };
  }
  counters.delete(blockKey);
  if (!rs.every((r) => r?.duration !== undefined)) return entryFor(blockKey);
  const time = Math.min(...rs.map((r) => r.time));
  const duration = Math.max(...rs.map((r) => r.time + r.duration)) - time;
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

const RESOLVER = {
  // 🔌 prompt.submit → turn.start (hooks UserPromptSubmit); hora = envío.
  // Sin turno aún (placeholder), la hora de envío pendiente. Notificaciones
  // de tareas u otros orígenes no humanos solo muestran su hora de creación.
  UserMessage: (e) => {
    if (e.requestId === "placeholder")
      return { time: pendingSubmit ?? Date.now() };
    if (!isUserOrigin(e.props.origin))
      return { time: entryFor(e.requestId).time };
    return { ...entryFor(e.requestId), icon: "🔌" };
  },
  // 🧠 generación del bloque de texto, thinking previo incluido. En ctrl+o
  // no trae margen superior propio.
  AssistantMessage: (e) => ({
    ...entryFor(e.requestId),
    icon: "🧠",
    noMargin: expandedView,
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
            ? Date.now() - runningCalls.get(e.props.tool_use_id)
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

// Handler unificado para todos los render sites del transcript.
//
// Tree-wrapping: en lugar de modificar props.text (que no todos los
// componentes tienen), se obtiene el árbol del engine via next(e) y se envuelve
// en un Box con flexDirection: 'column' y borderStyle: 'round'. El border
// genera automáticamente los caracteres box-drawing en todos los lados:
//   ╭─...─╮  ← borde superior
//   │ ... │  ← líneas verticales en los laterales
//   ╰─...─╯  ← borde inferior
//
// Ese Box va dentro de un Box `column-reverse` cuyo segundo hijo es el
// timestamp en un Box en flujo (marginLeft/marginRight: 2, marginBottom: -1)
// que se pinta sobre la fila del borde superior tras `╭─`. A su vez, el Box
// raíz exterior (`flexDirection: 'column', paddingTop: 1, flexGrow: 1`)
// añade como segundo hijo condicional el footer en flujo (marginLeft/marginRight: 2,
// marginTop: -1, justifyContent: 'flex-end'), superpuesto sobre la fila del
// borde inferior `╰─...─╯` sin usar `position: 'absolute'`. Al ir ambos en
// flujo, el scroll los recorta como a cualquier otra línea y el motor no
// fuerza `overflow: 'hidden'`. Con los márgenes ambos quedan acotados al ancho
// del recuadro y `wrap: 'truncate'` los recorta con `…` si el viewport es más
// angosto:
//   🕐 hora | ComponentType
//
// NOTA sobre `width`: el render engine RECHAZA la prop `width` en un Box que
// contiene un nodo engine ("engine node under a Box with prop width"). En su
// lugar, `flexGrow: 1` en el Box raíz y el espaciador `height: 0` con
// `e.viewport?.columns - 2` espacios fijan el ancho del recuadro al 100% del
// viewport en todos los componentes (incluido ToolGroup cuando desmonta su
// subfila en vivo dentro de un contenedor flexDirection: 'row').
//
// El margen superior que el engine da a cada mensaje se absorbe con un Box
// marginTop: -1 alrededor del árbol, para que no quede una fila vacía entre
// el header y el contenido (los componentes `noMargin` no lo traen y no lo
// absorben: CommandOutput, el ToolResult de Agent y AssistantMessage en ctrl+o).
//
// La hora y el footer de cada bloque los da RESOLVER, que solo lee lo fijado
// por los hooks de ciclo de vida (o el store en sesiones reanudadas). Lo
// único que se decide al dibujar es el recuadro, la vista (ctrl+o) y, en un
// ToolGroup, el contador o la duración cerrada.
//
// Visualmente:
//
//   ╭─ 🕐 2:23:05 p.m. | ToolGroup ─────╮
//   │  Read 1 file, ran 1 shell command │
//   ╰─────────────────────────── 🔧 7s ─╯
async function withTimestamp($, e, next) {
  if (
    e.component === "UserMessage" &&
    isUserOrigin(e.props.origin) &&
    !e.props.from &&
    !e.props.task
  ) {
    expandedView = Boolean(e.props.isExpanded);
  } else if (
    e.component === "ToolResult" &&
    typeof e.props.isExpanded === "boolean"
  ) {
    expandedView = e.props.isExpanded;
  }
  await loadStore($);
  const b = RESOLVER[e.component](e);
  if (b.unwrapped) return next(e);
  if (b.toSave) markForSave($, b.toSave);
  // Leer el segundo del reloj suscribe esta instancia: solo los bloques en
  // curso se redibujan en cada tick.
  if (b.subscribed) {
    await $.state.get({ plugin: "evolutivex-agents", key: "second" });
    scheduleClock($);
  }

  // Árbol del engine: el contenido original del componente
  const tree = await next(e);

  // Header con el timestamp, superpuesto sobre la línea del borde superior.
  // El Box con borderStyle: 'round' envuelve el engine y genera el marco;
  // el header es su hermano posterior en el Box column-reverse, en una fila
  // en flujo que se pinta tras el recuadro y que marginBottom: -1 sube sobre
  // el borde superior, tras `╭─`.
  const headerText = ` 🕐 ${formatClockTime(b.time)} | ${e.component} `;

  // El engine rechaza `position` alrededor del diálogo, y dentro de un borde
  // sus reglas horizontales (de ancho del viewport) se parten en dos filas:
  // el header va en flujo sobre el diálogo, sin recuadro.
  if (b.dialog) {
    return {
      type: "Box",
      props: { flexDirection: "column", paddingTop: 1, flexGrow: 1 },
      children: [
        { type: "Text", props: { wrap: "truncate" }, children: [headerText] },
        tree,
      ],
    };
  }

  // Footer en flujo con la duración del bloque una vez definitiva (o con el
  // contador en vivo); si no hay cifra, el borde inferior queda liso.
  // Con contador en curso: la cifra ya fijada (🧠 en el ToolUse) y `🔧 n s…`.
  const figures = [];
  if (b.counter !== undefined) {
    if (b.duration !== undefined)
      figures.push(`${b.icon} ${formatDuration(b.duration)}`);
    figures.push(`🔧 ${formatRunning(b.counter)}`);
  } else if (b.duration !== undefined) {
    figures.push(`${b.icon} ${formatDuration(b.duration)}`);
  }
  const footerText = figures.length ? ` ${figures.join(" · ")} ` : "";

  // Espaciador de alto 0: fija el ancho interno del recuadro a
  // `e.viewport.columns - 2` (+2 por los bordes verticales `│` = 100% del
  // viewport) sin usar `width`, evitando que ToolGroup se encoja al cerrarse.
  // Como Text en flujo con wrap: 'truncate', se adapta a viewports estrechos.
  const minWidth = e.viewport?.columns
    ? Math.max(0, e.viewport.columns - 2)
    : Math.max(headerText.length, footerText.length) + 2;

  return {
    type: "Box",
    props: { flexDirection: "column", paddingTop: 1, flexGrow: 1 },
    children: [
      {
        type: "Box",
        props: { flexDirection: "column-reverse" },
        children: [
          {
            type: "Box",
            props: {
              flexDirection: "column",
              borderStyle: "round",
            },
            children: [
              {
                type: "Box",
                props: {
                  flexDirection: "column",
                  marginTop: b.noMargin ? 0 : -1,
                },
                children: [tree],
              },
              {
                type: "Box",
                props: { height: 0, overflow: "hidden" },
                children: [
                  {
                    type: "Text",
                    props: { wrap: "truncate" },
                    children: [" ".repeat(minWidth)],
                  },
                ],
              },
            ],
          },
          {
            type: "Box",
            props: { marginLeft: 2, marginRight: 2, marginBottom: -1 },
            children: [
              {
                type: "Text",
                props: { wrap: "truncate" },
                children: [headerText],
              },
            ],
          },
        ],
      },
      ...(footerText
        ? [
            {
              type: "Box",
              props: {
                marginLeft: 2,
                marginRight: 2,
                marginTop: -1,
                justifyContent: "flex-end",
              },
              children: [
                {
                  type: "Text",
                  props: { wrap: "truncate" },
                  children: [footerText],
                },
              ],
            },
          ]
        : []),
    ],
  };
}

// Handler para el Spinner ("Thinking...").
// Antepone a la palabra (y al mensaje que la sustituye, si lo hay) el inicio
// del turno en curso de su agente (requestId: el agentId de un subagente, o
// el id de sesión en el principal); sin turno registrado, lo deja intacto.
// No se persiste.
// Ejemplo: "🕐 2:23:05 p.m. · Thinking…"
async function withSpinner($, e, next) {
  const turn = turns.get(e.requestId) ?? turns.get(MAIN);
  if (!turn) return next(e);
  const prefix = `🕐 ${formatClockTime(turn.start)} · `;
  const baseMessage = e.props.message ?? getActiveTaskLabel();
  return next({
    ...e,
    props: {
      ...e.props,
      word: prefix + e.props.word,
      message: baseMessage === null ? null : prefix + baseMessage,
    },
  });
}

// Handler para TurnDuration ("Completed in 15.3s").
// Añade al word el fin del turno: la hora de su fila (requestId), fijada y
// persistida por onAppend.
// Ejemplo: "🕐 2:23:20 p.m. · Completed in"
async function withTurnDuration($, e, next) {
  if (typeof e.props.isExpanded === "boolean")
    expandedView = e.props.isExpanded;
  await loadStore($);
  const { time } = entryFor(e.requestId);
  return next({
    ...e,
    props: {
      ...e.props,
      word: `🕐 ${formatClockTime(time)} · ${e.props.word}`,
    },
  });
}

// Claude Code llama a `register` una vez al cargar el plugin, con su
// userConfig en `options`. Sin `enhancedTranscript` activado no registra nada.
export function register(on, options) {
  if (options.enhancedTranscript !== true) return;

  // Todos los tipos de mensaje en el transcript — tree-wrapping unificado
  for (const component of [
    "UserMessage", // Mensajes del usuario
    "AssistantMessage", // Respuestas de Claude
    "ToolUse", // Llamada a una herramienta
    "ToolResult", // Resultado de una herramienta
    "ToolGroup", // Grupo colapsado de tool calls
    "CommandOutput", // Salida de comando shell
    "AskUserQuestion", // Diálogo de pregunta de Claude
  ]) {
    on("ui.render", { component }, withTimestamp);
  }

  // Status lines del terminal
  on("ui.render", { component: "Spinner" }, withSpinner);
  on("ui.render", { component: "TurnDuration" }, withTurnDuration);

  // Ciclo de vida: fuente de los tiempos de los footers
  on("prompt.submit", onSubmit).catch(($, e, next) => next(e));
  on("turn.start", onTurnStart);
  on("turn.step", onStep);
  on("tool.call", onToolCall).catch(($, e, next) => next(e));
  on("command.run", onCommandRun).catch(($, e, next) => next(e));
  on("session.append", onAppend).catch(($, e, next) => next(e));
  on("turn.complete", onTurnComplete);
}
