"use client";
import { CHART_COLORS } from "@/lib/format";

export default function Donut({ slices }: { slices: { label: string; value: number }[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <div className="muted" style={{ fontSize: 13 }}>Sin exposición abierta</div>;
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
            <span>{s.label}</span>
            <span className="muted">{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
