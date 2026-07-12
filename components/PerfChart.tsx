"use client";

export type Series = { label: string; color: string; points: { x: number; y: number }[] };

const fmtPctTick = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;
const fmtDateTick = (t: number) =>
  new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });

/** Performance chart in %: multiple series, 0% baseline, optional vertical
 *  marker (e.g. the client's entry date). Dependency-free SVG. */
export default function PerfChart({
  series, height = 210, markerX, markerLabel,
}: {
  series: Series[];
  height?: number;
  markerX?: number | null;
  markerLabel?: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const W = 560, H = height, L = 46, R = 8, T = 10, B = 22;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  let ymin = Math.min(...ys, 0), ymax = Math.max(...ys, 0);
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const yTicks = [0, 1, 2, 3].map((i) => ymin + ((ymax - ymin) * i) / 3);
  const nx = 4;
  const xTicks = Array.from({ length: nx }, (_, i) => xmin + ((xmax - xmin) * i) / (nx - 1));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize="10">{fmtPctTick(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={X(t)} y={H - 6}
            textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"}
            fill="var(--muted)" fontSize="10">{fmtDateTick(t)}</text>
        ))}
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)}
          stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" opacity=".7" />
        {markerX != null && markerX >= xmin && markerX <= xmax && (
          <g>
            <line x1={X(markerX)} x2={X(markerX)} y1={T} y2={H - B}
              stroke="var(--accent)" strokeDasharray="3 3" strokeWidth="1.2" />
            {markerLabel && (
              <text x={Math.min(X(markerX) + 4, W - 70)} y={T + 10} fill="var(--accent)" fontSize="10">{markerLabel}</text>
            )}
          </g>
        )}
        {series.map((s) => (
          <path key={s.label} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: s.color, display: "inline-block", borderRadius: 2 }} />
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
