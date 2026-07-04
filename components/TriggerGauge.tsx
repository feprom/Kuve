"use client";

/** Visual indicator of where price sits between the SHORT trigger (left, red)
 *  and the LONG trigger (right, green). Dot near an edge = breakout is close. */
export default function TriggerGauge({ price, longT, shortT }: {
  price: number; longT: number; shortT: number;
}) {
  const span = longT - shortT;
  const frac = span > 0 ? Math.min(1, Math.max(0, (price - shortT) / span)) : 0.5;
  const W = 90, H = 12, r = 4;
  const x = 6 + frac * (W - 12);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", marginLeft: "auto" }}>
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--red)" stopOpacity=".8" />
          <stop offset="50%" stopColor="var(--border)" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity=".8" />
        </linearGradient>
      </defs>
      <rect x="4" y={H / 2 - 2} width={W - 8} height="4" rx="2" fill="url(#tg)" />
      <circle cx={x} cy={H / 2} r={r} fill="var(--text)" stroke="var(--bg)" strokeWidth="1.5" />
    </svg>
  );
}
