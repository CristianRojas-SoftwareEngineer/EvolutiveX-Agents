// Agente de un evento: el subagente que lo emite, o el loop principal.
export const MAIN = "main";
export const agentOf = (e: { readonly agentId?: string }): string =>
  e.agentId ?? MAIN;
export const isUserOrigin = (origin?: { readonly kind: string }): boolean =>
  origin?.kind === "composer" || origin?.kind === "bridge";

// Inicio de cada tool.call en curso, por tool_use_id.
export const runningCalls = new Map<string, number>();
// ToolGroups con contador en vivo, por clave `g:`: `{ start, seen }`, con
// la hora de inicio del grupo y la del último dibujo (el contador del ToolUse
// sale de runningCalls).
export const counters = new Map<string, { start: number; seen: number }>();

// Turno en curso de cada agente: `{ turnId, start }`.
export const turns = new Map<string, { turnId: string; start: number }>();
// Última tool.call de cada agente mientras puede seguir una nueva: la borran
// el siguiente bloque de texto y el fin del turno. El ToolGroup que la
// contiene es la cola del agente y aún puede recibir llamadas.
export const lastCall = new Map<string, string>();
// Registro en sesión de tareas (TaskCreate / TaskUpdate / TodoWrite) para
// preservar el prefijo de hora en Spinner cuando props.message === null.
export const taskRegistry = new Map<
  string,
  { label?: string; status?: string }
>();

// Estado de sesión que se reasigna desde varios módulos: al vivir en un
// objeto compartido, cada módulo lee y escribe el mismo valor.
export const session: {
  pendingSubmit: number | undefined;
  expandedView: boolean;
  todoActiveLabel: string | undefined;
} = {
  // Hora de envío del prompt aún sin turno (UserMessage con requestId placeholder).
  pendingSubmit: undefined,
  // Vista ctrl+o activa: al conmutarla, el engine redibuja todos los
  // UserMessage (que traen `isExpanded`) antes que los AssistantMessage.
  expandedView: false,
  // Tarea en curso de TodoWrite (activeForm o content), que el Spinner antepone
  // cuando props.message === null.
  todoActiveLabel: undefined,
};

export const getActiveTaskLabel = (): string | null =>
  session.todoActiveLabel ??
  [...taskRegistry.values()].find((t) => t.status === "in_progress" && t.label)
    ?.label ??
  null;
