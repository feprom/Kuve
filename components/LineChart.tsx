"use client";
/**
 * Serie única con eje temporal — sobre TradingView Lightweight Charts.
 * Para el drawdown se dibuja como "underwater plot": área colgando de 0
 * (convención de IBKR/Portfolio Visualizer), no una línea suelta.
 */
import TvChart from "@/components/TvChart";
import { hex } from "@/lib/theme";

export default function LineChart({
  points, height = 200, color = "var(--accent)", baseline, suffix = "", label = "Serie",
}: {
  points: { x: number; y: number }[];
  height?: number;
  color?: string;
  baseline?: number;
  suffix?: string;
  label?: string;
}) {
  return (
    <TvChart
      series={[{ label, color: hex(color), points, area: true, width: 2 }]}
      height={height} suffix={suffix} baseline={baseline ?? null}
    />
  );
}
