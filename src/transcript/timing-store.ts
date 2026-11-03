import type { EngineInterface, Timer } from "claude-code";
import { pad2 } from "./format.js";

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

// Entrada de un bloque: hora de inicio (epoch ms), duración (ms) y si la
// fijó un evento (frente a la hora provisional de un render).
export type BlockTiming = {
  time: number;
  duration?: number;
  fromEvent?: boolean;
};

// Entradas persistidas de un día: `h` hora y `d` duración.
type DayData = Record<string, { h: number; d?: number }>;

export const blocks = new Map<string, BlockTiming>();
const dayBuckets = new Map<string, { data: DayData; bytes: number }>();
let storeLoaded: Promise<void> | undefined;
const pendingKeys = new Set<string>();
let flushTimer: Timer | undefined;

const bucketBytes = (key: string, data: DayData) =>
  key.length + JSON.stringify(data).length + 4;

// Desaloja en orden cronológico (FIFO) los buckets diarios más antiguos
// mientras el peso estimado del store supere MAX_STORE_BYTES (3.5 MiB).
async function enforceStoreBudget($: EngineInterface, keepDay?: string) {
  let total = 0;
  for (const b of dayBuckets.values()) total += b.bytes;
  while (total > MAX_STORE_BYTES) {
    const oldestKey = [...dayBuckets.keys()].sort().find((k) => k !== keepDay);
    if (!oldestKey) break;
    total -= dayBuckets.get(oldestKey)!.bytes;
    dayBuckets.delete(oldestKey);
    await $.store.delete(oldestKey);
  }
}

// Día local AAAA-MM-DD de un instante en epoch ms.
function dayOf(ms: number): string {
  const f = new Date(ms);
  return `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}

// Carga el store una sola vez por carga del módulo: borra los días vencidos
// o que excedan el presupuesto de bytes y vuelca el resto en `blocks` sin
// pisar lo que ya haya en memoria.
export function loadStore($: EngineInterface): Promise<void> {
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
      const data = ((await $.store.get(key)) ?? {}) as DayData;
      dayBuckets.set(key, { data, bytes: bucketBytes(key, data) });
    }
    await enforceStoreBudget($);
    for (const { data } of dayBuckets.values()) {
      for (const [blockKey, { h, d }] of Object.entries(data)) {
        if (!blocks.has(blockKey) || !blocks.get(blockKey)!.fromEvent) {
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
export function entryFor(blockKey: string): BlockTiming {
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
export function pinTiming(
  $: EngineInterface,
  blockKey: string,
  {
    time,
    duration,
    persist,
  }: { time: number; duration?: number; persist?: boolean },
): void {
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
export function markForSave($: EngineInterface, blockKey: string): void {
  pendingKeys.add(blockKey);
  flushTimer ??= $.clock.after(1000, () => flush($));
}

// Escribe las claves pendientes en el bucket del día de su hora. Relee cada
// bucket y lo fusiona antes de escribir, para no pisar otra sesión concurrente,
// garantizando que el store no supere MAX_STORE_BYTES.
async function flush($: EngineInterface): Promise<void> {
  flushTimer = undefined;
  const byDay = new Map<string, DayData>();
  for (const blockKey of pendingKeys) {
    const entry = blocks.get(blockKey);
    if (!entry) continue;
    const { time, duration } = entry;
    const day = DAY_PREFIX + dayOf(time);
    if (!byDay.has(day)) byDay.set(day, {});
    byDay.get(day)![blockKey] = { h: time, d: duration };
  }
  pendingKeys.clear();
  for (const [day, entries] of byDay) {
    const base =
      dayBuckets.get(day)?.data ??
      ((await $.store.get(day)) as DayData | null) ??
      {};
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
