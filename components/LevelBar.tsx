"use client";

/** Slider de una posición abierta: dónde está el precio entre el nivel de
 *  salida por stop (izquierda, rojo) y el mejor precio alcanzado desde la
 *  entrada — el lado de "toma de ganancias" del trailing (derecha, verde).
 *  La marca vertical es la entrada. Punto pegado a la izquierda = salida
 *  inminente; punto a la derecha = la posición corre a favor. */
export default function LevelBar({ sl, best, price, entry }: {
  sl: number; best: number; price: number; entry: number;
}) {
  const span = best - sl;
  const frac = (v: number) => (span !== 0 ? Math.min(1, Math.max(0, (v - sl) / span)) : 0.5);
  const W = 140, H = 14, r = 4.5;
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
      <rect x="4" y={H / 2 - 2} width={W - 8} height="4" rx="2" fill="url(#lb)" />
      {/* entrada */}
      <line x1={xEntry} y1="1" x2={xEntry} y2={H - 1} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="2 2" />
      {/* precio actual */}
      <circle cx={xPrice} cy={H / 2} r={r} fill="var(--text)" stroke="var(--bg)" strokeWidth="1.5" />
    </svg>
  );
}
