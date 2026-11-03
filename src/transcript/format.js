// Formatea un instante (epoch ms) en formato 12h con a.m. / p.m.
// 0h → 12 a.m., 13h → 1 p.m., 12h → 12 p.m.
export function formatClockTime(ms) {
  const date = new Date(ms);
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const suffix = h >= 12 ? "p.m." : "a.m.";
  h = h % 12 || 12; // 0 -> 12, 13 -> 1
  return `${h}:${m}:${s} ${suffix}`;
}

export const pad2 = (n) => String(n).padStart(2, "0");

// Formatea ms como `<0.1s`, `2.1s` (un decimal bajo 10 s), `45s`, `1m 05s`
// o `1h 02m 05s`.
export function formatDuration(ms) {
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
export function formatRunning(ms) {
  const s = Math.floor(ms / 1000);
  return (s < 10 ? `${s}s` : formatDuration(s * 1000)) + "…";
}
