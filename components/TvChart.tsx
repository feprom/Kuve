"use client";
/**
 * Chart financiero sobre TradingView Lightweight Charts (v5) — el motor que
 * usan las plataformas de trading reales: crosshair de precisión, escala
 * temporal correcta (huecos incluidos), pan/zoom táctil y render en canvas.
 *
 * Tema Kuve inyectado; la leyenda muestra el valor de cada serie BAJO EL
 * CURSOR (patrón TradingView) y vuelve al último valor al soltar.
 * Un hueco de datos > `gapMs` se dibuja como hueco real (whitespace), nunca
 * como una línea recta engañosa.
 */
import { useEffect, useRef, useState } from "react";
import {
  createChart, AreaSeries, LineSeries, ColorType, LineStyle,
  createSeriesMarkers,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type Time,
} from "lightweight-charts";

export type TvSerie = {
  label: string;
  color: string;              // hex (el canvas no resuelve var())
  points: { x: number; y: number }[]; // x = epoch ms, ascendente
  area?: boolean;             // area con degradado (la serie protagonista)
  width?: 1 | 2 | 3;
};

/**
 * Este archivo era el UNICO punto de todo el sistema que emitia guion ASCII y
 * punto decimal: `toFixed` devuelve "-1.23" y `toLocaleString("en-US")` devuelve
 * "1,234". Y sale en cada eje, cada leyenda y cada crosshair de todos los
 * charts, junto a cifras que el resto de la app imprime como "−1,23" y "1.234".
 * El mismo numero con dos ortografias en la misma pantalla.
 */
const MENOS = "−";
const fmtPct = (v: number) => {
  const r = Number(v.toFixed(2));
  return `${r > 0 ? "+" : r < 0 ? MENOS : ""}${Math.abs(r).toFixed(2).replace(".", ",")}%`;
};
const fmtNum = (v: number) =>
  (Math.abs(v) >= 1000 ? v.toLocaleString("es-ES", { maximumFractionDigits: 0 })
    : v.toLocaleString("es-ES", { maximumFractionDigits: 2 })).replace("-", MENOS);

export default function TvChart({
  series, height = 240, suffix = "%", markerX, markerLabel, baseline = 0, gapMs = 6 * 3600e3, onScrub,
}: {
  series: TvSerie[];
  height?: number;
  suffix?: string;            // "%" -> formateador de porcentaje; "" -> numérico
  markerX?: number | null;    // instante a marcar (p.ej. la entrada del cliente)
  markerLabel?: string;
  baseline?: number | null;   // línea punteada de referencia (0%)
  gapMs?: number;             // hueco de datos que se dibuja como hueco real
  onScrub?: (v: number | null) => void; // valor del ÁREA protagonista bajo el cursor (scrub tipo Robinhood)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hoverVals, setHoverVals] = useState<Record<string, number | null> | null>(null);
  const [hoverTime, setHoverTime] = useState<string | null>(null);

  const fmt = suffix === "%" ? fmtPct : (v: number) => `${fmtNum(v)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string, fb: string) => (css.getPropertyValue(n) || fb).trim() || fb;
    const chart = createChart(el, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tok("--muted", "#8b93a7"),
        fontSize: 11,
        fontFamily: "'Segoe UI', Roboto, Arial, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: tok("--grid", "#232c3a"), style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixRightEdge: true,
        fixLeftEdge: true,
      },
      crosshair: {
        vertLine: { color: tok("--muted", "#8b93a7"), width: 1, style: LineStyle.Dashed, labelBackgroundColor: tok("--panel2", "#12161d") },
        horzLine: { color: tok("--muted", "#8b93a7"), width: 1, style: LineStyle.Dashed, labelBackgroundColor: tok("--panel2", "#12161d") },
      },
      localization: {
        locale: "es-ES",
        priceFormatter: fmt,
      },
      handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, mouseWheel: false },
      handleScale: { pinch: true, mouseWheel: false, axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const apis: { label: string; api: ISeriesApi<"Area" | "Line">; area: boolean }[] = [];
    for (const s of series) {
      if (s.points.length < 2) continue;
      const api = s.area
        ? chart.addSeries(AreaSeries, {
            lineColor: s.color, lineWidth: s.width ?? 2,
            topColor: s.color + "38", bottomColor: s.color + "00",
            priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerRadius: 4,
          })
        : chart.addSeries(LineSeries, {
            color: s.color, lineWidth: s.width ?? 2,
            priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerRadius: 3,
          });
      // Huecos REALES: un tramo sin datos se corta con whitespace en vez de
      // dibujarse como recta inventada. El umbral se deriva del muestreo de
      // CADA serie (mediana de los deltas × 6): una serie diaria no se tritura
      // con un umbral pensado para la horaria. El whitespace va en un segundo
      // estrictamente intermedio (tiempos no ascendentes rompen el renderer).
      const deltas: number[] = [];
      for (let i = 1; i < s.points.length; i++) deltas.push(s.points[i].x - s.points[i - 1].x);
      const med = deltas.slice().sort((a, b) => a - b)[deltas.length >> 1] || 3600e3;
      const lim = Math.max(med * 6, gapMs);
      const data: ({ time: UTCTimestamp; value: number } | { time: UTCTimestamp })[] = [];
      let prevSec: number | null = null;
      for (const p of s.points) {
        const t = Math.floor(p.x / 1000);
        if (prevSec != null && t <= prevSec) continue; // dedupe/orden estricto
        if (prevSec != null && (t - prevSec) * 1000 > lim && t - prevSec > 1) {
          data.push({ time: (prevSec + 1) as UTCTimestamp });
        }
        data.push({ time: t as UTCTimestamp, value: p.y });
        prevSec = t;
      }
      api.setData(data);
      apis.push({ label: s.label, api, area: !!s.area });
    }

    if (baseline != null && apis.length) {
      apis[0].api.createPriceLine({
        price: baseline, color: tok("--muted", "#8b93a7"), lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "",
      });
    }
    if (markerX != null && apis.length) {
      const m: SeriesMarker<Time> = {
        time: Math.floor(markerX / 1000) as UTCTimestamp,
        position: "belowBar", shape: "arrowUp",
        color: (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#29a9e1").trim(),
        text: markerLabel ?? "",
      };
      createSeriesMarkers(apis[0].api, [m]);
    }

    chart.timeScale().fitContent();

    const protagonista = apis.find((a) => a.area) ?? apis[apis.length - 1];
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHoverVals(null); setHoverTime(null); onScrub?.(null);
        return;
      }
      const vals: Record<string, number | null> = {};
      for (const { label, api } of apis) {
        const d = param.seriesData.get(api) as { value?: number } | undefined;
        vals[label] = typeof d?.value === "number" ? d.value : null;
      }
      setHoverVals(vals);
      if (protagonista) {
        const d = param.seriesData.get(protagonista.api) as { value?: number } | undefined;
        onScrub?.(typeof d?.value === "number" ? d.value : null);
      }
      const t = (param.time as number) * 1000;
      setHoverTime(new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
    });

    return () => { chart.remove(); chartRef.current = null; };
    // series cambia por identidad en cada carga de datos; el chart se
    // reconstruye entero — barato en canvas y evita estados a medias
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(series.map((s) => [s.label, s.color, s.points.length, s.points[s.points.length - 1]?.y]))]);

  const visibles = series.filter((s) => s.points.length >= 2);
  if (!visibles.length)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;

  return (
    <div>
      <div ref={ref} style={{ height, width: "100%" }} role="img"
        aria-label={visibles.map((s) => `${s.label}: ${fmt(s.points[s.points.length - 1].y)}`).join(", ")} />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, fontSize: 12, alignItems: "baseline" }}>
        {visibles.map((s) => {
          const v = hoverVals ? hoverVals[s.label] : s.points[s.points.length - 1].y;
          return (
            <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 14, height: 3, background: s.color, display: "inline-block", borderRadius: 2 }} />
              <span className="muted">{s.label}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{v == null ? "—" : fmt(v)}</b>
            </span>
          );
        })}
        {hoverTime && <span className="muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{hoverTime}</span>}
      </div>
    </div>
  );
}
