// Dibujo del transcript enriquecido.
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

import type { EngineInterface, MatchedHook, RenderElement } from "claude-code";
import { RESOLVER, type TranscriptComponent } from "./resolver.js";
import { entryFor, loadStore, markForSave } from "./timing-store.js";
import { scheduleClock } from "./live-clock.js";
import { formatClockTime, formatDuration, formatRunning } from "./format.js";
import {
  MAIN,
  getActiveTaskLabel,
  isUserOrigin,
  session,
  turns,
} from "./session.js";

// Firmas de los hooks de ui.render que registra index.ts.
type TimestampHook = MatchedHook<
  "ui.render",
  { component: readonly TranscriptComponent[] }
>;
type SpinnerHook = MatchedHook<"ui.render", { component: "Spinner" }>;
type TurnDurationHook = MatchedHook<"ui.render", { component: "TurnDuration" }>;

// La vista ctrl+o se deduce de `isExpanded` en los mensajes de usuario reales
// (no de otro agente ni de una tarea) y en ToolResult.
function trackExpandedView(e: Parameters<TimestampHook>[1]): void {
  if (
    e.component === "UserMessage" &&
    isUserOrigin(e.props.origin) &&
    !e.props.from &&
    !e.props.task
  ) {
    session.expandedView = Boolean(e.props.isExpanded);
  } else if (
    e.component === "ToolResult" &&
    typeof e.props.isExpanded === "boolean"
  ) {
    session.expandedView = e.props.isExpanded;
  }
}

// Footer en flujo con la duración del bloque una vez definitiva (o con el
// contador en vivo); sin cifra, "" y el borde inferior queda liso. Con
// contador en curso: la cifra ya fijada (🧠 en el ToolUse) y `🔧 n s…`.
function footerTextOf(b: {
  icon?: string;
  duration?: number;
  counter?: number;
}): string {
  const figures = [];
  if (b.duration !== undefined)
    figures.push(`${b.icon} ${formatDuration(b.duration)}`);
  if (b.counter !== undefined) figures.push(`🔧 ${formatRunning(b.counter)}`);
  return figures.length ? ` ${figures.join(" · ")} ` : "";
}

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
export async function withTimestamp(
  $: EngineInterface,
  e: Parameters<TimestampHook>[1],
  next: Parameters<TimestampHook>[2],
): Promise<RenderElement> {
  trackExpandedView(e);
  await loadStore($);
  const b = RESOLVER[e.component](e as never);
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

  const footerText = footerTextOf(b);

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
        ? ([
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
          ] satisfies RenderElement[])
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
export async function withSpinner(
  $: EngineInterface,
  e: Parameters<SpinnerHook>[1],
  next: Parameters<SpinnerHook>[2],
) {
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
export async function withTurnDuration(
  $: EngineInterface,
  e: Parameters<TurnDurationHook>[1],
  next: Parameters<TurnDurationHook>[2],
) {
  if (typeof e.props.isExpanded === "boolean")
    session.expandedView = e.props.isExpanded;
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
