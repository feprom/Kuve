"use client";
/**
 * Chart de rendimiento en % — ahora sobre el motor TradingView Lightweight
 * Charts (TvChart): crosshair de precisión, escala temporal real con huecos,
 * leyenda con el valor bajo el cursor. La serie de la CUENTA es el área
 * protagonista; la estrategia queda como línea secundaria.
 */
import TvChart from "@/components/TvChart";
import { hex } from "@/lib/theme";

export type Series = { label: string; color: string; points: { x: number; y: number }[] };


export default function PerfChart({
  series, height = 240, markerX, markerLabel, onScrub,
}: {
  series: Series[];
  height?: number;
  markerX?: number | null;
  markerLabel?: string;
  onScrub?: (v: number | null) => void;
}) {
  // la serie "cuenta" (accent) es el área protagonista; el resto, líneas finas
  const tv = series.map((s) => ({
    label: s.label,
    color: hex(s.color),
    points: s.points,
    area: s.color === "var(--accent)",
    width: (s.color === "var(--accent)" ? 2 : 2) as 2,
  }));
  return (
    <TvChart series={tv} height={height} suffix="%" baseline={0}
      markerX={markerX} markerLabel={markerLabel} onScrub={onScrub} />
  );
}
