// Agente de un evento: el subagente que lo emite, o el loop principal.
export const MAIN = "main";
export const agentOf = (e) => e.agentId ?? MAIN;
export const isUserOrigin = (origin) =>
  origin?.kind === "composer" || origin?.kind === "bridge";

// Inicio de cada tool.call en curso, por tool_use_id.
export const runningCalls = new Map();
// ToolGroups con contador en vivo, por clave `g:`: `{ start, seen }`, con
// la hora de inicio del grupo y la del último dibujo (el contador del ToolUse
// sale de runningCalls).
export const counters = new Map();

// Turno en curso de cada agente: `{ turnId, start }`.
export const turns = new Map();
// Última tool.call de cada agente mientras puede seguir una nueva: la borran
// el siguiente bloque de texto y el fin del turno. El ToolGroup que la
// contiene es la cola del agente y aún puede recibir llamadas.
export const lastCall = new Map();
// Registro en sesión de tareas (TaskCreate / TaskUpdate / TodoWrite) para
// preservar el prefijo de hora en Spinner cuando props.message === null.
export const taskRegistry = new Map();

// Estado de sesión que se reasigna desde varios módulos: al vivir en un
// objeto compartido, cada módulo lee y escribe el mismo valor.
export const session = {
  // Hora de envío del prompt aún sin turno (UserMessage con requestId placeholder).
  pendingSubmit: undefined,
  // Vista ctrl+o activa: al conmutarla, el engine redibuja todos los
  // UserMessage (que traen `isExpanded`) antes que los AssistantMessage.
  expandedView: false,
  // Tarea en curso de TodoWrite (activeForm o content), que el Spinner antepone
  // cuando props.message === null.
  todoActiveLabel: undefined,
};

export const getActiveTaskLabel = () =>
  session.todoActiveLabel ??
  [...taskRegistry.values()].find((t) => t.status === "in_progress" && t.label)
    ?.label ??
  null;
