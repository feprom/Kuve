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
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}
        role="img" aria-label={`Composición de la exposición: ${slices.map((s) => `${s.label.replace("USDT", "")} ${((s.value / total) * 100).toFixed(0)}%`).join(", ")}`}>
        {slices.map((s, i) => {
          const frac = s.value / total;
          // hueco de 2px entre sectores: los colores adyacentes no se tocan
          // (regla de marcas de dataviz; ayuda además en visión con daltonismo)
          const largo = Math.max(0.5, frac * C - (slices.length > 1 ? 2 : 0));
          const dash = `${largo} ${C - largo}`;
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
            {/* siempre presente: la leyenda es una grilla de columnas fijas */}
            {s.side === "CORTO"
              ? <span className="dir short" title="Posición corta (vendida) — la dirección no indica resultado">▼</span>
              : s.side === "LARGO"
                ? <span className="dir long" title="Posición larga (comprada) — la dirección no indica resultado">▲</span>
                : <span aria-hidden />}
            <span className="muted pctcell">{((s.value / total) * 100).toFixed(1)}%</span>
            <span className="muted usd">· ${fmtUsd(s.value, 0)}</span>
            {s.pnl != null && <b className={pnlClass(s.pnl)} style={{ marginLeft: 4 }}>{s.pnl >= 0 ? "+" : ""}{fmtUsd(s.pnl)}</b>}
          </div>
        ))}
      </div>
    </div>
  );
}
