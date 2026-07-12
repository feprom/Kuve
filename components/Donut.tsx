"use client";
import { CHART_COLORS, fmtUsd, pnlClass } from "@/lib/format";

export type Slice = { label: string; value: number; side?: "LARGO" | "CORTO" | string; pnl?: number | null };

/** Exposure composition donut. Values are |notional| per asset; the legend
 *  marks direction: ▲ long (green) / ▼ short (red). */
export default function Donut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <div className="muted" style={{ fontSize: 13 }}>Sin exposición abierta — 100% del capital en USDT</div>;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="compbody">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {slices.map((s, i) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C}`;
          const off = -acc * C;
          acc += frac;
          return (
            <circle key={s.label} cx="70" cy="70" r={R} fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth="16"
              strokeDasharray={dash} strokeDashoffset={off}
              transform="rotate(-90 70 70)" />
          );
        })}
        <text x="70" y="75" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="700">
          {slices.length}
        </text>
      </svg>
      <div className="legend">
        {slices.map((s, i) => (
          <div className="row" key={s.label}>
            <span className="sw" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span>{s.label.replace("USDT", "")}</span>
            {s.side === "CORTO"
              ? <span className="neg" title="Posición corta (vendida)">▼</span>
              : s.side === "LARGO"
                ? <span className="pos" title="Posición larga (comprada)">▲</span>
                : null}
            <span className="muted">{((s.value / total) * 100).toFixed(1)}%</span>
            <span className="muted">· ${fmtUsd(s.value, 0)}</span>
            {s.pnl != null && <b className={pnlClass(s.pnl)} style={{ marginLeft: 4 }}>{s.pnl >= 0 ? "+" : ""}{fmtUsd(s.pnl)}</b>}
          </div>
        ))}
      </div>
    </div>
  );
}
