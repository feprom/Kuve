"use client";

/** Dependency-free SVG line chart (equity curve / progress). */
export default function LineChart({
  points, height = 180, color = "var(--accent)", baseline,
}: {
  points: { x: number; y: number }[];
  height?: number;
  color?: string;
  baseline?: number; // dashed reference (e.g. start equity)
}) {
  if (points.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const W = 560, H = height, PAD = 8;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (baseline != null) { ymin = Math.min(ymin, baseline); ymax = Math.max(ymax, baseline); }
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x: number) => PAD + ((x - xmin) / (xmax - xmin)) * (W - 2 * PAD);
  const Y = (y: number) => H - PAD - ((y - ymin) / (ymax - ymin)) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${X(xmax).toFixed(1)},${H - PAD} L${X(xmin).toFixed(1)},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {baseline != null && (
        <line x1={PAD} x2={W - PAD} y1={Y(baseline)} y2={Y(baseline)}
          stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" opacity=".6" />
      )}
      <path d={area} fill="url(#eqfill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
