// src/transcript/session.ts
var MAIN = "main";
var agentOf = (e) => e.agentId ?? MAIN;
var isUserOrigin = (origin) => origin?.kind === "composer" || origin?.kind === "bridge";
var runningCalls = /* @__PURE__ */ new Map();
var counters = /* @__PURE__ */ new Map();
var turns = /* @__PURE__ */ new Map();
var lastCall = /* @__PURE__ */ new Map();
var taskRegistry = /* @__PURE__ */ new Map();
var session = {
  // Hora de envío del prompt aún sin turno (UserMessage con requestId placeholder).
  pendingSubmit: void 0,
  // Vista ctrl+o activa: al conmutarla, el engine redibuja todos los
  // UserMessage (que traen `isExpanded`) antes que los AssistantMessage.
  expandedView: false,
  // Tarea en curso de TodoWrite (activeForm o content), que el Spinner antepone
  // cuando props.message === null.
  todoActiveLabel: void 0
};
var getActiveTaskLabel = () => session.todoActiveLabel ?? [...taskRegistry.values()].find((t) => t.status === "in_progress" && t.label)?.label ?? null;

// src/transcript/guard.ts
var FAILURE_LIMIT = 3;
var streaks = /* @__PURE__ */ new Map();
var disabled = false;
var disableListeners = [];
var belowErrors = /* @__PURE__ */ new WeakSet();
var isDisabled = () => disabled;
function onDisable(listener) {
  disableListeners.push(listener);
}
function recordSuccess(name) {
  streaks.delete(name);
}
function recordFailure($, name, message) {
  if (disabled) return;
  const streak = (streaks.get(name) ?? 0) + 1;
  streaks.set(name, streak);
  if (streak < FAILURE_LIMIT) return;
  disabled = true;
  for (const listener of disableListeners) listener();
  runningCalls.clear();
  counters.clear();
  void $.session.version().catch(() => void 0).then(
    (v) => $.ui.toast(
      `Transcript enriquecido desactivado en esta sesi\xF3n: ${name}: ${message}. Claude Code ${v?.version ?? "desconocida"}`
    )
  );
}
var messageOf = (err) => err instanceof Error ? err.message : String(err);
var isBelow = (err) => typeof err === "object" && err !== null && belowErrors.has(err);
async function guardCall($, name, run, native) {
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
function countTimeout($, name, error) {
  if (error.kind === "timeout")
    recordFailure($, name, error.message ?? "timeout");
}
function caught($, name, e, next) {
  countTimeout($, name, next.error);
  return next(e);
}
function belowStream(stream) {
  async function* inner() {
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

// src/transcript/format.ts
function formatClockTime(ms) {
  const date = new Date(ms);
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const suffix = h >= 12 ? "p.m." : "a.m.";
  h = h % 12 || 12;
  return `${h}:${m}:${s} ${suffix}`;
}
var pad2 = (n) => String(n).padStart(2, "0");
function formatDuration(ms) {
  if (ms < 100) return "<0.1s";
  if (ms < 9950) return `${(ms / 1e3).toFixed(1)}s`;
  const total = Math.round(ms / 1e3);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h) return `${h}h ${pad2(m)}m ${pad2(s)}s`;
  if (m) return `${m}m ${pad2(s)}s`;
  return `${s}s`;
}
function formatRunning(ms) {
  const s = Math.floor(ms / 1e3);
  return (s < 10 ? `${s}s` : formatDuration(s * 1e3)) + "\u2026";
}

// src/transcript/timing-store.ts
var RETENTION_DAYS = 30;
var MAX_STORE_BYTES = 3670016;
var DAY_PREFIX = "days/";
var blocks = /* @__PURE__ */ new Map();
var dayBuckets = /* @__PURE__ */ new Map();
var storeLoaded;
var pendingKeys = /* @__PURE__ */ new Set();
var flushTimer;
var bucketBytes = (key, data) => key.length + JSON.stringify(data).length + 4;
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
function dayOf(ms) {
  const f = new Date(ms);
  return `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}
function loadStore($) {
  storeLoaded ??= (async () => {
    const cutoff = dayOf(Date.now() - RETENTION_DAYS * 864e5);
    const dayKeys = (await $.store.keys()).filter((k) => k.startsWith(DAY_PREFIX)).sort();
    for (const key of dayKeys) {
      if (key.slice(DAY_PREFIX.length) < cutoff) {
        await $.store.delete(key);
        continue;
      }
      const data = await $.store.get(key) ?? {};
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
function entryFor(blockKey) {
  let b = blocks.get(blockKey);
  if (!b) {
    b = { time: Date.now() };
    blocks.set(blockKey, b);
  }
  return b;
}
function pinTiming($, blockKey, {
  time,
  duration,
  persist
}) {
  const b = blocks.get(blockKey);
  if (b?.fromEvent) {
    if (b.duration !== void 0 || duration === void 0) return;
    b.duration = duration;
  } else {
    blocks.set(blockKey, { time, duration, fromEvent: true });
  }
  if (persist) void loadStore($).then(() => markForSave($, blockKey));
}
function markForSave($, blockKey) {
  pendingKeys.add(blockKey);
  flushTimer ??= $.clock.after(
    1e3,
    () => flush($).then(
      () => recordSuccess("flush"),
      (err) => recordFailure($, "flush", messageOf(err))
    )
  );
}
async function flush($) {
  flushTimer = void 0;
  const byDay = /* @__PURE__ */ new Map();
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
    const base = dayBuckets.get(day)?.data ?? await $.store.get(day) ?? {};
    const merged = { ...base, ...entries };
    dayBuckets.set(day, { data: merged, bytes: bucketBytes(day, merged) });
    await enforceStoreBudget($, day);
    try {
      await $.store.set(day, merged);
    } catch {
      const oldest = (await $.store.keys()).filter((k) => k.startsWith(DAY_PREFIX) && k !== day).sort()[0];
      if (oldest) {
        dayBuckets.delete(oldest);
        await $.store.delete(oldest);
        try {
          await $.store.set(day, merged);
        } catch {
        }
      }
    }
  }
}

// src/transcript/live-clock.ts
var clock;
var TICK_MARGIN_MS = 20;
var COUNTER_EXPIRY_MS = 3e3;
function stopClock() {
  clock?.timer.cancel();
  clock = void 0;
}
onDisable(stopClock);
function scheduleClock($) {
  const now = Date.now();
  for (const [blockKey, c] of counters) {
    if (c.seen < now - COUNTER_EXPIRY_MS) counters.delete(blockKey);
  }
  if (!runningCalls.size && !counters.size) {
    stopClock();
    return;
  }
  const starts = [
    ...runningCalls.values(),
    ...[...counters.values()].map((c) => c.start)
  ];
  const at = Math.min(
    ...starts.map((h) => h + (Math.floor((now - h) / 1e3) + 1) * 1e3)
  ) + TICK_MARGIN_MS;
  if (clock && clock.at <= at) return;
  clock?.timer.cancel();
  clock = {
    at,
    timer: $.clock.after(at - now, () => {
      clock = void 0;
      try {
        void $.state.set(
          { plugin: "evolutivex-agents", key: "second" },
          Date.now()
        );
        scheduleClock($);
        recordSuccess("clock");
      } catch (err) {
        recordFailure($, "clock", messageOf(err));
      }
    })
  };
}

// src/transcript/lifecycle.ts
var PRUNE_MS = 36e5;
var DRAWN_DOORS = /* @__PURE__ */ new Set([
  "prompt",
  "delivery",
  "response",
  "command",
  "notice"
]);
var currentPrompt;
var modelBlocks = /* @__PURE__ */ new Map();
var commands = [];
var commandAwaitingOutput;
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
    session.pendingSubmit = Date.now();
    currentPrompt = { submittedAt: session.pendingSubmit };
  }
  return next(e);
}
function completePrompt($) {
  const { submittedAt, rowKey, turnStart } = currentPrompt;
  if (rowKey === void 0) return;
  pinTiming($, rowKey, {
    time: submittedAt,
    duration: turnStart === void 0 ? void 0 : turnStart - submittedAt,
    persist: true
  });
  if (turnStart !== void 0) currentPrompt = void 0;
}
async function onTurnStart($, e, next) {
  const now = Date.now();
  turns.set(MAIN, { turnId: e.turnId, start: now });
  session.pendingSubmit = void 0;
  if (currentPrompt) {
    currentPrompt.turnStart = now;
    const drawn = currentPrompt.rowKey !== void 0;
    completePrompt($);
    if (drawn) $.ui.invalidate("ui.render");
  }
  return next(e);
}
async function onTurnComplete($, e, next) {
  turns.delete(agentOf(e));
  lastCall.delete(agentOf(e));
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, Date.now());
  return next(e);
}
var BLOCK_KINDS = /* @__PURE__ */ new Set(["text", "thinking", "tool", "input"]);
var isBlockChunk = (chunk) => BLOCK_KINDS.has(chunk.kind);
function registerBlock(agent, b) {
  if (!modelBlocks.has(agent)) modelBlocks.set(agent, []);
  modelBlocks.get(agent).push(b);
}
function unregisterBlock(agent, b) {
  const list = modelBlocks.get(agent);
  const idx = list ? list.indexOf(b) : -1;
  if (idx >= 0) list.splice(idx, 1);
}
function reveal(step, b) {
  b.visible = true;
  step.previous = b;
  registerBlock(step.agent, b);
}
function blockFor(step, chunk, now) {
  let b = step.byIndex.get(chunk.index);
  if (b) return b;
  b = {
    kind: chunk.kind,
    text: "",
    first: now,
    last: now,
    attributedStart: step.previous?.last ?? step.start,
    visible: false
  };
  step.byIndex.set(chunk.index, b);
  if (b.kind === "tool") reveal(step, b);
  return b;
}
function updateVisibility($, step, b, chunk, now) {
  if (b.visible) return;
  if (b.kind === "text") {
    const previous = step.previous;
    if (previous?.kind === "thinking") {
      b.attributedStart = previous.attributedStart;
      unregisterBlock(step.agent, previous);
    }
  } else if (b.kind === "thinking" && chunk.kind === "thinking" && chunk.text.trim()) {
    b.attributedStart = step.previous?.last ?? step.start;
  } else {
    return;
  }
  reveal(step, b);
  lastCall.delete(step.agent);
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, now);
}
function accountChunk($, step, chunk) {
  const now = Date.now();
  const b = blockFor(step, chunk, now);
  updateVisibility($, step, b, chunk, now);
  b.last = now;
  if (chunk.kind === "tool") b.toolId = chunk.id;
  if (chunk.kind === "text" || chunk.kind === "thinking") b.text += chunk.text;
}
async function* onStep($, e, next) {
  if (isDisabled()) return yield* next(e);
  const agent = agentOf(e);
  const start = Date.now();
  if (turns.get(agent)?.turnId !== e.turnId)
    turns.set(agent, { turnId: e.turnId, start });
  const step = { agent, start, byIndex: /* @__PURE__ */ new Map() };
  let failed = false;
  const stream = next(e)[Symbol.asyncIterator]();
  for (; ; ) {
    const { value: chunk, done } = await stream.next();
    if (done) {
      prune();
      if (!failed) recordSuccess("turn.step");
      return chunk;
    }
    if (!failed && isBlockChunk(chunk)) {
      try {
        accountChunk($, step, chunk);
      } catch (err) {
        failed = true;
        recordFailure($, "turn.step", messageOf(err));
      }
    }
    yield chunk;
  }
}
function consumeBlock(agent, predicate) {
  const list = modelBlocks.get(agent);
  const i = list?.findIndex(predicate) ?? -1;
  return i < 0 ? void 0 : list.splice(i, 1)[0];
}
async function onToolCall($, e, next) {
  const start = Date.now();
  runningCalls.set(e.tool_use_id, start);
  lastCall.set(agentOf(e), e.tool_use_id);
  scheduleClock($);
  const b = consumeBlock(agentOf(e), (b2) => b2.toolId === e.tool_use_id);
  if (b)
    pinTiming($, `u:${e.tool_use_id}`, {
      time: b.attributedStart,
      duration: b.last - b.attributedStart,
      persist: true
    });
  if (e.tool === "TodoWrite" && Array.isArray(e.todos)) {
    const active = e.todos.find((t) => t.status === "in_progress");
    session.todoActiveLabel = active ? active.activeForm ?? active.content : void 0;
  } else if (e.tool === "TaskUpdate" && e.taskId !== void 0) {
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
      const id = out?.result?.task?.id ?? /^Task #(\S+)/.exec(out?.text ?? "")?.[1];
      if (id !== void 0) {
        taskRegistry.set(String(id), {
          label: e.activeForm ?? e.subject,
          status: "pending"
        });
      }
    }
    return out;
  } finally {
    runningCalls.delete(e.tool_use_id);
    pinTiming($, `r:${e.tool_use_id}`, {
      time: start,
      duration: Date.now() - start,
      persist: true
    });
    void $.state.set(
      { plugin: "evolutivex-agents", key: "second" },
      Date.now()
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
var textOf = (message) => message.content.map(
  (b) => b.type === "text" ? b.text ?? "" : b.type === "thinking" ? b.thinking ?? "" : ""
).join("");
function appendPrompt($, e, row) {
  if (!e.agentId && isUserOrigin(e.origin) && currentPrompt && currentPrompt.rowKey === void 0) {
    currentPrompt.rowKey = e.uuid;
    completePrompt($);
  } else {
    pinTiming($, e.uuid, row);
  }
}
function appendResponse($, e, text, row) {
  if (!text.trim()) return;
  lastCall.delete(agentOf(e));
  const b = consumeBlock(
    agentOf(e),
    (b2) => (b2.kind === "text" || b2.kind === "thinking") && b2.text.trim() === text.trim()
  );
  pinTiming(
    $,
    e.uuid,
    b ? {
      time: b.attributedStart,
      duration: b.last - b.attributedStart,
      persist: true
    } : row
  );
  $.ui.invalidate("ui.render");
  void $.state.set({ plugin: "evolutivex-agents", key: "second" }, row.time);
}
function appendCommand($, e, text, row) {
  const name = /<command-name>\/?([^<]+)<\/command-name>/.exec(text)?.[1];
  if (name !== void 0) {
    const i = commands.findLastIndex((c) => c.command === name);
    commandAwaitingOutput = i < 0 ? void 0 : commands.splice(i, 1)[0];
  } else if (/<local-command-std(out|err)>/.test(text)) {
    const c = commandAwaitingOutput;
    commandAwaitingOutput = void 0;
    pinTiming(
      $,
      e.uuid,
      c ? { time: c.start, duration: c.end - c.start, persist: true } : row
    );
  }
}
async function onAppend($, e, next) {
  if (!DRAWN_DOORS.has(e.door)) return next(e);
  const text = textOf(e.message);
  const row = { time: Date.now(), persist: true };
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

// src/transcript/resolver.ts
function awaitsAnotherCall(calls) {
  const ids = new Set(calls.map((c) => c.tool_use_id));
  return [...lastCall.values()].some((id) => ids.has(id));
}
function group(calls, isActive) {
  const blockKey = `g:${calls[0].tool_use_id}`;
  const now = Date.now();
  const rs = calls.map((c) => blocks.get(`r:${c.tool_use_id}`));
  if (calls.some((c) => c.isRunning || runningCalls.has(c.tool_use_id)) || isActive !== false && awaitsAnotherCall(calls)) {
    const starts = calls.map(
      (c, i) => runningCalls.get(c.tool_use_id) ?? (rs[i]?.duration !== void 0 ? rs[i].time : void 0)
    ).filter((h) => h !== void 0);
    const time2 = starts.length ? Math.min(...starts) : entryFor(blockKey).time;
    counters.set(blockKey, { start: time2, seen: now });
    return { time: time2, counter: now - time2, subscribed: true };
  }
  counters.delete(blockKey);
  if (!rs.every((r) => r?.duration !== void 0)) return entryFor(blockKey);
  const time = Math.min(...rs.map((r) => r.time));
  const duration = Math.max(...rs.map((r) => r.time + r.duration)) - time;
  const g = blocks.get(blockKey);
  if (g?.time === time && g.duration === duration) return g;
  blocks.set(blockKey, { time, duration, fromEvent: true });
  return { time, duration, toSave: blockKey };
}
var NO_CONTENT = /* @__PURE__ */ new Set(["SubagentHandback"]);
var RESOLVER = {
  // 🔌 prompt.submit → turn.start (hooks UserPromptSubmit); hora = envío.
  // Sin turno aún (placeholder), la hora de envío pendiente. Notificaciones
  // de tareas u otros orígenes no humanos solo muestran su hora de creación.
  UserMessage: (e) => {
    if (e.requestId === "placeholder")
      return { time: session.pendingSubmit ?? Date.now() };
    if (!isUserOrigin(e.props.origin))
      return { time: entryFor(e.requestId).time };
    return { ...entryFor(e.requestId), icon: "\u{1F50C}" };
  },
  // 🧠 generación del bloque de texto, thinking previo incluido. En ctrl+o
  // no trae margen superior propio.
  AssistantMessage: (e) => ({
    ...entryFor(e.requestId),
    icon: "\u{1F9E0}",
    noMargin: session.expandedView,
    subscribed: blocks.get(e.requestId)?.duration === void 0
  }),
  // 🧠 escritura de la llamada; la fija onToolCall al arrancar tool.call.
  // Mientras su llamada corre, `counter` es el tiempo desde el inicio de
  // tool.call y el footer añade `🔧 n s…` a la cifra 🧠; `subscribed` mantiene la instancia
  // atenta al reloj hasta que tool.call termina (r: con duración), también
  // antes de que arranque.
  ToolUse: (e) => e.props.tool === "AskUserQuestion" || NO_CONTENT.has(e.props.tool) ? { unwrapped: true } : {
    ...entryFor(`u:${e.props.tool_use_id}`),
    icon: "\u{1F9E0}",
    counter: runningCalls.has(e.props.tool_use_id) ? Date.now() - runningCalls.get(e.props.tool_use_id) : void 0,
    subscribed: blocks.get(`r:${e.props.tool_use_id}`)?.duration === void 0
  },
  // 🔧 intervalo de tool.call (permiso incluido), fijado al terminar; 👤 en
  // AskUserQuestion. El de Agent no trae margen superior propio.
  ToolResult: (e) => NO_CONTENT.has(e.props.tool) ? { unwrapped: true } : {
    ...entryFor(`r:${e.props.tool_use_id}`),
    icon: e.props.tool === "AskUserQuestion" ? "\u{1F464}" : "\u{1F527}",
    noMargin: e.props.tool === "Agent"
  },
  // 🔧 inicio de la primera tool.call hasta el fin de la última.
  ToolGroup: (e) => ({ ...group(e.props.calls, e.props.isActive), icon: "\u{1F527}" }),
  // 🔧 intervalo de command.run. Su salida no trae margen superior propio.
  CommandOutput: (e) => ({
    ...entryFor(e.requestId),
    icon: "\u{1F527}",
    noMargin: true
  }),
  // Diálogo: solo header, con el inicio de su tool.call; va en flujo y sin
  // recuadro porque el engine rechaza `position` alrededor del diálogo.
  AskUserQuestion: (e) => ({
    time: runningCalls.get(e.requestId) ?? entryFor(`r:${e.requestId}`).time,
    dialog: true
  })
};

// src/transcript/render.ts
function trackExpandedView(e) {
  if (e.component === "UserMessage" && isUserOrigin(e.props.origin) && !e.props.from && !e.props.task) {
    session.expandedView = Boolean(e.props.isExpanded);
  } else if (e.component === "ToolResult" && typeof e.props.isExpanded === "boolean") {
    session.expandedView = e.props.isExpanded;
  }
}
function footerTextOf(b) {
  const figures = [];
  if (b.duration !== void 0)
    figures.push(`${b.icon} ${formatDuration(b.duration)}`);
  if (b.counter !== void 0) figures.push(`\u{1F527} ${formatRunning(b.counter)}`);
  return figures.length ? ` ${figures.join(" \xB7 ")} ` : "";
}
async function withTimestamp($, e, next) {
  trackExpandedView(e);
  await loadStore($);
  const b = RESOLVER[e.component](e);
  if (b.unwrapped) return next(e);
  if (b.toSave) markForSave($, b.toSave);
  if (b.subscribed) {
    await $.state.get({ plugin: "evolutivex-agents", key: "second" });
    scheduleClock($);
  }
  const tree = await next(e);
  const headerText = ` \u{1F550} ${formatClockTime(b.time)} | ${e.component} `;
  if (b.dialog) {
    return {
      type: "Box",
      props: { flexDirection: "column", paddingTop: 1, flexGrow: 1 },
      children: [
        { type: "Text", props: { wrap: "truncate" }, children: [headerText] },
        tree
      ]
    };
  }
  const footerText = footerTextOf(b);
  const minWidth = e.viewport?.columns ? Math.max(0, e.viewport.columns - 2) : Math.max(headerText.length, footerText.length) + 2;
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
              borderStyle: "round"
            },
            children: [
              {
                type: "Box",
                props: {
                  flexDirection: "column",
                  marginTop: b.noMargin ? 0 : -1
                },
                children: [tree]
              },
              {
                type: "Box",
                props: { height: 0, overflow: "hidden" },
                children: [
                  {
                    type: "Text",
                    props: { wrap: "truncate" },
                    children: [" ".repeat(minWidth)]
                  }
                ]
              }
            ]
          },
          {
            type: "Box",
            props: { marginLeft: 2, marginRight: 2, marginBottom: -1 },
            children: [
              {
                type: "Text",
                props: { wrap: "truncate" },
                children: [headerText]
              }
            ]
          }
        ]
      },
      ...footerText ? [
        {
          type: "Box",
          props: {
            marginLeft: 2,
            marginRight: 2,
            marginTop: -1,
            justifyContent: "flex-end"
          },
          children: [
            {
              type: "Text",
              props: { wrap: "truncate" },
              children: [footerText]
            }
          ]
        }
      ] : []
    ]
  };
}
async function withSpinner($, e, next) {
  const turn = turns.get(e.requestId) ?? turns.get(MAIN);
  if (!turn) return next(e);
  const prefix = `\u{1F550} ${formatClockTime(turn.start)} \xB7 `;
  const baseMessage = e.props.message ?? getActiveTaskLabel();
  return next({
    ...e,
    props: {
      ...e.props,
      word: prefix + e.props.word,
      message: baseMessage === null ? null : prefix + baseMessage
    }
  });
}
async function withTurnDuration($, e, next) {
  if (typeof e.props.isExpanded === "boolean")
    session.expandedView = e.props.isExpanded;
  await loadStore($);
  const { time } = entryFor(e.requestId);
  return next({
    ...e,
    props: {
      ...e.props,
      word: `\u{1F550} ${formatClockTime(time)} \xB7 ${e.props.word}`
    }
  });
}

// src/transcript/index.ts
function register(on, options) {
  if (options.enhancedTranscript !== true) return;
  for (const component of [
    "UserMessage",
    // Mensajes del usuario
    "AssistantMessage",
    // Respuestas de Claude
    "ToolUse",
    // Llamada a una herramienta
    "ToolResult",
    // Resultado de una herramienta
    "ToolGroup",
    // Grupo colapsado de tool calls
    "CommandOutput",
    // Salida de comando shell
    "AskUserQuestion"
    // Diálogo de pregunta de Claude
  ]) {
    on(
      "ui.render",
      { component: [component] },
      ($, e, next) => guardCall(
        $,
        "withTimestamp",
        () => withTimestamp($, e, next),
        () => next(e)
      )
    ).catch(($, e, next) => caught($, "withTimestamp", e, next));
  }
  on(
    "ui.render",
    { component: "Spinner" },
    ($, e, next) => guardCall(
      $,
      "withSpinner",
      () => withSpinner($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "withSpinner", e, next));
  on(
    "ui.render",
    { component: "TurnDuration" },
    ($, e, next) => guardCall(
      $,
      "withTurnDuration",
      () => withTurnDuration($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "withTurnDuration", e, next));
  on(
    "prompt.submit",
    ($, e, next) => guardCall(
      $,
      "prompt.submit",
      () => onSubmit($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "prompt.submit", e, next));
  on(
    "turn.start",
    ($, e, next) => guardCall(
      $,
      "turn.start",
      () => onTurnStart($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "turn.start", e, next));
  on("turn.step", onStep).catch(async function* ($, e, next) {
    countTimeout($, "turn.step", next.error);
    return yield* belowStream(next(e));
  });
  on(
    "tool.call",
    ($, e, next) => guardCall(
      $,
      "tool.call",
      () => onToolCall($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "tool.call", e, next));
  on(
    "command.run",
    ($, e, next) => guardCall(
      $,
      "command.run",
      () => onCommandRun($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "command.run", e, next));
  on(
    "session.append",
    ($, e, next) => guardCall(
      $,
      "session.append",
      () => onAppend($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "session.append", e, next));
  on(
    "turn.complete",
    ($, e, next) => guardCall(
      $,
      "turn.complete",
      () => onTurnComplete($, e, next),
      () => next(e)
    )
  ).catch(($, e, next) => caught($, "turn.complete", e, next));
}
export {
  register
};
