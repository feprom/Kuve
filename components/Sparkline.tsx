"use client";

/** Minimal dependency-free sparkline: no axes, no ticks — just the line
 *  (and a faint area fill), meant to sit inside a small card. */
export default function Sparkline({
  points, color = "var(--accent)", height = 44,
}: {
  points: { x: number; y: number }[];
  color?: string;
  height?: number;
}) {
  if (points.length < 2)
    return <div className="muted" style={{ fontSize: 11, height }}>Sin historial suficiente</div>;
  const W = 240, H = height;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x: number) => ((x - xmin) / (xmax - xmin)) * W;
  const Y = (y: number) => H - ((y - ymin) / (ymax - ymin)) * H;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${W},${H} L0,${H} Z`;
  const gid = `spk${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" />
    </svg>
  );
}
