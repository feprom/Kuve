"use client";

export type Candle = { t: number; o: number; h: number; l: number; c: number };

const fmtTick = (v: number) =>
  Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

const fmtDateTick = (t: number) =>
  new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });

/** Daily candlestick chart (SVG, dependency-free) with date/number axes. */
export default function CandleChart({ candles, height = 220 }: { candles: Candle[]; height?: number }) {
  if (candles.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes días de historial</div>;
  const W = 560, H = height, L = 46, R = 8, T = 8, B = 22;
  let ymin = Math.min(...candles.map((c) => c.l));
  let ymax = Math.max(...candles.map((c) => c.h));
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
  const n = candles.length;
  const slot = (W - L - R) / n;
  const bw = Math.max(2, Math.min(14, slot * 0.6));
  const X = (i: number) => L + slot * i + slot / 2;
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  const yTicks = [0, 1, 2, 3].map((i) => ymin + ((ymax - ymin) * i) / 3);
  const step = Math.max(1, Math.floor(n / 4));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize="10">{fmtTick(v)}</text>
        </g>
      ))}
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? "var(--green)" : "var(--red)";
        const bodyTop = Y(Math.max(c.o, c.c));
        const bodyH = Math.max(1, Math.abs(Y(c.o) - Y(c.c)));
        return (
          <g key={c.t}>
            <line x1={X(i)} x2={X(i)} y1={Y(c.h)} y2={Y(c.l)} stroke={col} strokeWidth="1" />
            <rect x={X(i) - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} rx="1" />
            {i % step === 0 && (
              <text x={X(i)} y={H - 6} textAnchor="middle" fill="var(--muted)" fontSize="10">
                {fmtDateTick(c.t)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
