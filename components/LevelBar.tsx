"use client";

/** Slider de una posición abierta: dónde está el precio entre el nivel de
 *  salida por stop (izquierda, rojo, con su valor) y el mejor precio alcanzado
 *  desde la entrada — el lado de "toma de ganancias" del trailing (derecha,
 *  verde, con su valor). La marca vertical es la entrada. Punto pegado a la
 *  izquierda = salida inminente; `breached` = el SL ya fue cruzado (punto rojo). */
const fmtN = (v: number) =>
  v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v >= 10 ? v.toFixed(2) : v.toFixed(4);

export default function LevelBar({ sl, best, price, entry, breached = false }: {
  sl: number; best: number; price: number; entry: number; breached?: boolean;
}) {
  const span = best - sl;
  const frac = (v: number) => (span !== 0 ? Math.min(1, Math.max(0, (v - sl) / span)) : 0.5);
  const W = 170, H = 30, r = 4.5, barY = 8;
  const xPrice = 6 + frac(price) * (W - 12);
  const xEntry = 6 + frac(entry) * (W - 12);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", marginLeft: "auto" }}>
      <defs>
        <linearGradient id="lb" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--red)" stopOpacity=".85" />
          <stop offset="50%" stopColor="var(--border)" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity=".85" />
        </linearGradient>
      </defs>
      <rect x="4" y={barY - 2} width={W - 8} height="4" rx="2" fill="url(#lb)" />
      {/* entrada */}
      <line x1={xEntry} y1="1" x2={xEntry} y2={barY + 6} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="2 2" />
      {/* precio actual */}
      <circle cx={xPrice} cy={barY} r={r}
        fill={breached ? "var(--red)" : "var(--text)"} stroke="var(--bg)" strokeWidth="1.5" />
      {/* números: SL a la izquierda, TP a la derecha */}
      <text x="4" y={H - 3} fill="var(--red)" fontSize="9.5" fontWeight="600">{fmtN(sl)}</text>
      <text x={W - 4} y={H - 3} textAnchor="end" fill="var(--green)" fontSize="9.5" fontWeight="600">{fmtN(best)}</text>
    </svg>
  );
}
