"use client";

const fmtTick = (v: number) =>
  Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

const fmtDateTick = (t: number) => {
  const d = new Date(t);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
};

/** Dependency-free SVG line chart with date X axis and numeric Y axis. */
export default function LineChart({
  points, height = 200, color = "var(--accent)", baseline, suffix = "",
}: {
  points: { x: number; y: number }[];   // x = epoch ms
  height?: number;
  color?: string;
  baseline?: number;
  suffix?: string;                       // e.g. "%" for drawdown
}) {
  if (points.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const W = 560, H = height, L = 46, R = 8, T = 8, B = 22;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (baseline != null) { ymin = Math.min(ymin, baseline); ymax = Math.max(ymax, baseline); }
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.05; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${X(xmax).toFixed(1)},${H - B} L${X(xmin).toFixed(1)},${H - B} Z`;
  const yTicks = [0, 1, 2, 3].map((i) => ymin + ((ymax - ymin) * i) / 3);
  const nx = Math.min(4, points.length);
  const xTicks = Array.from({ length: nx }, (_, i) => xmin + ((xmax - xmin) * i) / (nx - 1));
  const gid = `lg${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize="10">
            {fmtTick(v)}{suffix}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={X(t)} y={H - 6}
          textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"}
          fill="var(--muted)" fontSize="10">
          {fmtDateTick(t)}
        </text>
      ))}
      {baseline != null && (
        <line x1={L} x2={W - R} y1={Y(baseline)} y2={Y(baseline)}
          stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" opacity=".7" />
      )}
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
