"use client";
/**
 * Vista UNIFICADA de una cuenta — la misma para el cliente (dashboard) y para
 * el admin al entrar a un cliente. Recibe el registro del cliente y carga todo
 * lo demás por client_id.
 *
 * Jerarquía: arriba lo importante (equity, PnL del bot, no realizado, drawdown
 * del bot); en "Detalle de costos y cuenta" lo secundario (realizado, mercado,
 * comisiones, funding, heredado, exposición, margen, apalancamiento, trades).
 *
 * Consistencia: el PnL total (bot), la curva azul del gráfico y el drawdown
 * salen TODOS de la misma serie: equity(t) − capital aportado hasta t − cierres
 * heredados (posiciones previas al bot). Por eso el número grande, el gráfico y
 * el drawdown siempre cuadran entre sí y llegan a la última vela.
 *
 * Ningún número se calcula acá: todo sale de lib/metrics.ts, que es el único
 * lugar donde vive cada fórmula. El porcentaje es TIME-WEIGHTED — neutraliza
 * depósitos y retiros. Con el retorno ingenuo, un depósito se mostraba como
 * ganancia (Roberto: +45,65% falso contra −5,2% real).
 */
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, fmtDateUtc, pnlClass } from "@/lib/format";
import Donut from "@/components/Donut";
import TriggerGauge from "@/components/TriggerGauge";
import LevelBar from "@/components/LevelBar";
import AssetName from "@/components/AssetName";
import PerfChart from "@/components/PerfChart";
import EventFeed from "@/components/EventFeed";
import { computeLevels, Levels, STRATEGY_PARAMS } from "@/lib/levels";
import { attributeIncome, Attribution, IncomeRow, esApertura } from "@/lib/pnl";
import {
  detectarFlujos, seriePnl, curvaTwr, maxDrawdown, serieBenchmark, sanearSnaps,
  factorVivo as factorVivoDe, twrEntre, pnlEntre, variantOf,
} from "@/lib/metrics";
import { fetchSnaps, fetchIncome, fetchTrades, fetchOrdersFilled, fetchEvents } from "@/lib/queries";
import type { EventRow } from "@/lib/events";

type Snap = {
  ts: string; bar_time: string; equity: number; wallet_balance: number; unrealized_pnl: number;
  margin_used: number; exposure_notional: number; dd_pct: number; realized_cum: number;
  start_equity: number; n_trades: number;
};
type Pos = { id: number; symbol: string; side: string; pos_amt: number; price: number; entry_price: number; unrealized_pnl: number };
type Trade = { id: number; ts: string; symbol: string; side: string; profit: number };
type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string; created_at: string };

function dedupeBySymbol(rows: Pos[]): Pos[] {
  const seen = new Map<string, Pos>();
  for (const r of rows) {
    const prev = seen.get(r.symbol);
    if (!prev || r.id > prev.id) seen.set(r.symbol, r);
  }
  return Array.from(seen.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export default function AccountView({ client, esAdmin = false }: { client: any; esAdmin?: boolean }) {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [income, setIncome] = useState<Attribution | null>(null);
  const [ledger, setLedger] = useState<IncomeRow[]>([]);   // crudo: incluye TRANSFER
  const [levels, setLevels] = useState<Record<string, Levels | null>>({});
  const [bench, setBench] = useState<{ date: string; equity_index: number }[]>([]);
  const [rango, setRango] = useState<"1m" | "3m" | "ytd" | "entrada">("3m");
  const [live, setLive] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventRow[]>([]);
  const tuyo = esAdmin ? "del cliente" : "tuyo";

  useEffect(() => {
    if (!client?.id) return;
    let alive = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const variant = variantOf(client?.risk_profiles?.atr_mult);
        // carga paginada COMPLETA: sin esto PostgREST corta en max-rows y la
        // serie pierde su inception en silencio (el TWR arrancaría tarde)
        const snapRows = sanearSnaps((await fetchSnaps(sb, client.id)) as unknown as Snap[]);
        const latest = snapRows[snapRows.length - 1];
        const [b, sig, t, p, inc, ord, ev] = await Promise.all([
          client.risk_profile_id
            ? sb.from("strategy_benchmark").select("date, equity_index").eq("profile_id", client.risk_profile_id).order("date", { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
          // 40 filas ≈ varias barras: la última barra completa se arma por símbolo
          sb.from("strategy_signals").select("*").eq("variant", variant).order("bar_time", { ascending: false }).limit(40),
          fetchTrades(sb, client.id).then((data) => ({ data })),
          latest?.bar_time
            ? sb.from("positions").select("*").eq("client_id", client.id).eq("bar_time", latest.bar_time)
            : Promise.resolve({ data: [] as any[] }),
          snapRows[0]?.ts
            ? fetchIncome(sb, client.id, snapRows[0].ts).then((data) => ({ data }))
            : Promise.resolve({ data: [] as any[] }),
          fetchOrdersFilled(sb, client.id).then((data) => ({ data })),
          fetchEvents(sb, client.id, 60),
        ]);
        if (!alive) return;
        setSnaps(snapRows);
        setBench((b as any).data ?? []);
        setSignals(((sig as any).data ?? []) as Signal[]);
        setTrades(((t as any).data ?? []) as Trade[]);
        // IMPORTANTE: deduplicar PRIMERO (gana la fila más nueva por id) y recién
        // después filtrar los ceros. Si se filtra antes, una fila vieja "abierta"
        // le gana a la fila nueva que registró el cierre (pos_amt=0) cuando el
        // bot reprocesa la misma vela tras un reinicio.
        setPositions(dedupeBySymbol((((p as any).data ?? []) as Pos[])).filter((r) => r.pos_amt !== 0));
        const incRows = (((inc as any).data ?? []) as IncomeRow[]);
        setLedger(incRows);
        setIncome(attributeIncome(incRows, ((t as any).data ?? []), ((ord as any).data ?? [])));
        setEventos(((ev as any).data ?? []) as EventRow[]);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [client?.id]);

  // Niveles de salida (SL dinámico + canal + mejor precio) por posición,
  // calculados en el navegador con velas de Binance (reglas exactas del motor).
  useEffect(() => {
    if (!positions.length) { setLevels({}); return; }
    let alive = true;
    (async () => {
      const out: Record<string, Levels | null> = {};
      await Promise.all(positions.map(async (p) => {
        const sideNum: 1 | -1 = p.pos_amt > 0 ? 1 : -1;
        const openSide = sideNum > 0 ? "BUY" : "SELL";
        const entryTrade = trades.find((t) => t.symbol === p.symbol && t.side === openSide && !t.profit);
        const entryMs = entryTrade ? new Date(entryTrade.ts).getTime() : Date.now() - 30 * 86400e3;
        out[p.symbol] = await computeLevels(p.symbol, sideNum, entryMs, p.entry_price);
      }));
      if (alive) setLevels(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [positions, trades]);

  // Precios EN VIVO de las posiciones abiertas (ticker público de Binance),
  // refrescados cada 15 s: la tabla "Corriendo" se mueve entre velas. El PnL
  // total y el equity siguen siendo por vela (los escribe el bot cada hora).
  useEffect(() => {
    if (!positions.length) { setLive({}); return; }
    let alive = true;
    const wanted = new Set(positions.map((p) => p.symbol));
    const load = async () => {
      // UNA sola llamada para todos los símbolos (el ticker sin symbol devuelve
      // todo el mercado): evita N peticiones cada 15 s y el rate-limit de Binance
      const out: Record<string, number> = {};
      try {
        const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/price");
        if (r.ok) {
          const j = (await r.json()) as { symbol: string; price: string }[];
          for (const x of j) if (wanted.has(x.symbol)) { const v = +x.price; if (v > 0) out[x.symbol] = v; }
        }
      } catch { /* sin red: la fila mantiene el precio de la vela */ }
      if (alive && Object.keys(out).length) setLive((prev) => ({ ...prev, ...out }));
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line
  }, [positions]);

  // ---- MÉTRICAS (todas de lib/metrics.ts), memoizadas: el tick de 15 s de los
  // precios en vivo NO debe recalcular flujos/series sobre miles de barras ----
  const met = useMemo(() => {
    const flujos = detectarFlujos(snaps, ledger);
    const heredadoFills = income?.heredadoFills ?? [];
    const botSeries = seriePnl(snaps, flujos, heredadoFills);
    const curva = curvaTwr(snaps, flujos, heredadoFills);
    return { flujos, heredadoFills, botSeries, curva };
  }, [snaps, ledger, income]);

  if (loading) return (
    <>
      <div className="skel" style={{ height: 118, marginBottom: 10 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="skel" style={{ height: 64 }} /><div className="skel" style={{ height: 64 }} />
      </div>
      <div className="skel" style={{ height: 280, marginBottom: 14 }} />
      <div className="skel" style={{ height: 180 }} />
    </>
  );
  if (err) return (
    <div className="card"><h2>No se pudieron cargar los datos</h2>
      <p className="note">Error: {err}. Reintentá recargando la página; si persiste, avisanos.</p>
    </div>
  );

  const snap = snaps[snaps.length - 1] ?? null;
  if (!snap) return (
    <div className="card"><h2>Sin datos aún</h2>
      <p className="note">Cuando el bot procese la cuenta (cada hora) aparecerán aquí balance y posiciones.</p>
    </div>
  );

  // Movimientos de capital: el ledger de Binance (TRANSFER) manda; el salto de
  // equity no explicado es la red de seguridad si el ledger viniera atrasado.
  const { flujos, heredadoFills, botSeries, curva } = met;
  const capitalHoy = botSeries[botSeries.length - 1]?.base ?? 0;
  const pnlAbs = botSeries.length ? botSeries[botSeries.length - 1].pnl : null;

  // ---- EN VIVO (15 s): un solo dato para métricas, tabla y composición ----
  const enVivo = Object.keys(live).length > 0;
  const pxOf = (p: Pos) => live[p.symbol] ?? p.price;
  const upnlLiveTot = positions.reduce((a, p) =>
    a + (p.entry_price ? p.pos_amt * (pxOf(p) - p.entry_price) : (p.unrealized_pnl ?? 0)), 0);
  const expLive = positions.reduce((a, p) => a + Math.abs(p.pos_amt * pxOf(p)), 0);
  // sin uPnL de vela no hay base para ajustar: mejor 0 que inflar el equity
  const adjVivo = enVivo && snap.unrealized_pnl != null ? upnlLiveTot - snap.unrealized_pnl : 0;
  const equityShow = snap.equity + adjVivo;
  const pnlShow = pnlAbs == null ? null : pnlAbs + adjVivo;
  const cuentaAbs = capitalHoy ? equityShow - capitalHoy : null;
  const upnlShow = enVivo ? upnlLiveTot : snap.unrealized_pnl;
  // el tramo en vivo se encadena al índice vía lib/metrics: neutraliza un
  // depósito/retiro ocurrido entre la última vela y ahora
  const factorVivo = factorVivoDe(snaps, flujos, heredadoFills, enVivo ? equityShow : null);
  const totalPctShow = factorVivo != null && curva.length > 1 ? (factorVivo - 1) * 100 : null;
  // drawdown sobre la curva time-weighted: un depósito ya no infla el pico
  const ddBot = maxDrawdown([...curva.map((p) => p.y), ...(factorVivo != null ? [factorVivo] : [])]);

  const leverage = equityShow ? expLive / equityShow : null;
  const freeUsdt = Math.max(0, equityShow - (snap.margin_used ?? 0));
  const marginPct = equityShow ? ((snap.margin_used ?? 0) / equityShow) * 100 : null;
  const slices = positions.map((p) => ({
    label: p.symbol, value: Math.abs(p.pos_amt * pxOf(p)), side: p.side,
    pnl: p.entry_price ? p.pos_amt * (pxOf(p) - p.entry_price) : p.unrealized_pnl,
  }));
  const openSyms = new Set(positions.map((p) => p.symbol));
  // última señal del motor por símbolo (variante del perfil): fuente de verdad
  // de lo que el bot hará con cada posición en la próxima vela. Se arma ANTES
  // de "pending" para que nunca haya dos filas del mismo símbolo aunque la
  // consulta traiga varias barras.
  const sigBySym = new Map<string, Signal>();
  for (const s of signals) if (!sigBySym.has(s.symbol)) sigBySym.set(s.symbol, s);
  const pending = Array.from(sigBySym.values())
    .filter((s) => !openSyms.has(s.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const profName: string = client?.risk_profiles?.name ?? "";

  // ---- rendimiento: la ventana muestra mínimo 3 meses (o YTD, o desde la
  // entrada). Ambas curvas se rebasean a 0% al inicio de la ventana; la curva
  // del cliente se ancla al nivel de la estrategia en su fecha de entrada para
  // que sean comparables. La estrategia llega hasta la última vela (el bot
  // refresca el punto de hoy en cada vela).
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;
  const now = Date.now();
  const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const baseStart = rango === "ytd" ? jan1
    : rango === "1m" ? now - 31 * 86400e3
    : rango === "3m" ? now - 92 * 86400e3
    : (entryTs ?? now);
  // en 1M/3M la ventana NO se extiende hasta la entrada: es la ventana pedida
  const windowStart = rango === "entrada" && entryTs != null ? entryTs
    : rango === "ytd" && entryTs != null ? Math.min(jan1, entryTs) === jan1 ? jan1 : entryTs
    : Math.max(baseStart, entryTs ?? baseStart);
  // el % que gobierna la cabecera del grafico es el de SU ventana
  const pctVentana = twrEntre(curva, windowStart, now);
  const stratPts = serieBenchmark(bench, windowStart, now);
  // % de la estrategia (ya rebaseada) en la fecha de entrada del cliente
  let anchorEntry = 0;
  if (entryTs != null) for (const p of stratPts) if (p.x <= entryTs) anchorEntry = p.y;
  // la cuenta se dibuja con su retorno time-weighted, anclado a ese nivel, y
  // RECORTADA a la ventana visible (si no, en "3M" la línea se dibuja fuera)
  const clientPts = curva.length > 1
    ? curva.map((p) => ({ x: p.x, y: anchorEntry + (p.y - 1) * 100 })).filter((p) => p.x >= windowStart)
    : [];
  const series = [
    { label: "Estrategia " + profName, color: "var(--strategy)", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: esAdmin ? "Cuenta del cliente (bot)" : "Tu cuenta (bot)", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);

  // ---- RESUMEN DE LA SEMANA (últimos 7 días, sobre las series canónicas) ----
  // % time-weighted del tramo (twrEntre) y USD del bot (pnlEntre): un depósito
  // del martes no cuenta como ganancia ni distorsiona el denominador.
  const weekStartTs = now - 7 * 86400e3;
  // "hoy" = desde las 00:00 UTC (las velas del bot son UTC)
  const hoy0 = new Date(now); const todayStartTs = Date.UTC(hoy0.getUTCFullYear(), hoy0.getUTCMonth(), hoy0.getUTCDate());
  const pnlHoyVela = pnlEntre(botSeries, todayStartTs, now);
  const pnlHoy = pnlHoyVela == null ? null : pnlHoyVela + adjVivo;
  const pctHoy = twrEntre(curva, todayStartTs, now);
  const pnlSemanaPct = twrEntre(curva, weekStartTs, now);
  const pnlSemanaVela = pnlEntre(botSeries, weekStartTs, now);
  const pnlSemana = pnlSemanaVela == null ? null : pnlSemanaVela + adjVivo;
  const wTrades = trades.filter((t) => new Date(t.ts).getTime() >= weekStartTs);
  const wCierres = wTrades.filter((t) => t.profit);
  const wGan = wCierres.filter((t) => t.profit > 0);
  const wPer = wCierres.filter((t) => t.profit < 0);
  const wRealizado = wCierres.reduce((a, t) => a + t.profit, 0);
  const wAperturas = Array.from(new Set(wTrades.filter(esApertura).map((t) => t.symbol?.replace("USDT", ""))));
  const posCierre = positions.filter((p) => {
    const sg = sigBySym.get(p.symbol);
    return sg && sg.side !== (p.pos_amt > 0 ? 1 : -1);
  });
  const posCerca = positions.filter((p) => {
    const lvx = levels[p.symbol]; if (!lvx) return false;
    const px = live[p.symbol] ?? p.price;
    const d = (p.pos_amt < 0 ? lvx.slEff / px - 1 : 1 - lvx.slEff / px) * 100;
    return d > 0 && d < 2;
  });
  const fEs = (t: number) => new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "long" });

  return (
    <>
      {/* ============ ESTADO DE SINCRONIZACION ============ */}
      {(() => {
        const edadMin = (now - new Date(snap.ts).getTime()) / 60e3;
        const cls = edadMin > 180 ? "bad" : edadMin > 90 ? "warn" : "";
        const proxVela = 60 - Math.floor((Date.now() % 3600e3) / 60e3);
        return (
          <div className="syncbar">
            <span className={`dot ${cls}`} aria-hidden />
            <span>{cls === "" ? "Sincronizado" : cls === "warn" ? `Última vela hace ${Math.round(edadMin)} min` : "Sin datos frescos"} · vela {fmtDateUtc(snap.ts)}</span>
            {enVivo && <span>· precios en vivo (15 s)</span>}
            <span style={{ marginLeft: "auto" }}>próxima vela en {proxVela} min</span>
          </div>
        );
      })()}

      {/* ============ LO IMPORTANTE: UN heroe, el resto subordinado ============ */}
      <div className="metric-row">
        <div className="metric hero">
          <div className="l">Equity{enVivo ? " · en vivo" : ""}</div>
          <div className="v" aria-live="polite">
            <span key={Math.round(equityShow * 100)} className={enVivo ? "tick" : undefined}>${fmtUsd(equityShow)}</span>
          </div>
          <div className="sub">
            <span className={pnlClass(pnlHoy)}><b>{fmtUsd(pnlHoy)}</b> ({fmtPct(pctHoy)}) hoy</span>
            <span className={pnlClass(pnlShow)}
              title="PnL y rendimiento time-weighted del bot desde tu entrada: los depósitos y retiros no cuentan como ganancia ni como pérdida.">
              <b>{fmtUsd(pnlShow)}</b> ({fmtPct(totalPctShow)}) total
            </span>
          </div>
        </div>
        <div className="metric"><div className={`v ${pnlClass(upnlShow)}`}>{fmtUsd(upnlShow)}</div><div className="l">No realizado (posiciones)</div></div>
        <div className="metric"
          title="La mayor caída desde el punto más alto que tocó la cuenta (no desde el capital inicial). Puede ser mayor que el PnL total: la cuenta primero subió a un pico y luego bajó.">
          <div className={`v ${pnlClass(ddBot)}`}>{fmtPct(ddBot, 1)}</div><div className="l">Drawdown máx. (desde el pico)</div>
        </div>
      </div>

      {/* ============ SEGUNDO PLANO ============ */}
      <details className="card" style={{ marginBottom: 14 }}>
        <summary>Detalle de costos, exposición y cuenta completa</summary>
        <div className="metric-row" style={{ marginTop: 12 }}>
          {income && (
            <>
              <div className="metric"><div className={`v ${pnlClass(income.realizadoNeto)}`}>{fmtUsd(income.realizadoNeto)}</div><div className="l">Realizado neto (bot, ledger)</div></div>
              <div className="metric"><div className={`v ${pnlClass(income.mercado)}`}>{fmtUsd(income.mercado)}</div><div className="l">Mercado (cierres del bot)</div></div>
              <div className="metric"><div className={`v ${pnlClass(income.comisiones)}`}>{fmtUsd(income.comisiones)}</div><div className="l">Comisiones</div></div>
              <div className="metric"><div className={`v ${pnlClass(income.funding)}`}>{fmtUsd(income.funding)}</div><div className="l">Funding</div></div>
              {income.heredado !== 0 && (
                <div className="metric"><div className="v muted">{fmtUsd(income.heredado)}</div><div className="l">Posiciones previas al bot (excluido)</div></div>
              )}
            </>
          )}
          {cuentaAbs != null && (
            <div className="metric" title="Equity de hoy menos todo el capital aportado (inicial más depósitos, menos retiros). Incluye lo que dejaron las posiciones previas al bot.">
              <div className={`v ${pnlClass(cuentaAbs)}`}>{fmtUsd(cuentaAbs)}</div><div className="l">PnL cuenta completa</div>
            </div>
          )}
          <div className="metric" title="Capital inicial más los depósitos, menos los retiros, hasta hoy.">
            <div className="v">${fmtUsd(capitalHoy, 0)}</div><div className="l">Capital aportado</div>
          </div>
          <div className="metric"><div className="v">${fmtUsd(snap.exposure_notional, 0)}</div><div className="l">Exposición</div></div>
          <div className="metric"><div className="v">${fmtUsd(snap.margin_used, 0)}</div><div className="l">Margen usado ({marginPct?.toFixed(1)}%)</div></div>
          <div className="metric"><div className="v">{leverage == null ? "—" : `x${leverage.toFixed(2)}`}</div><div className="l">Apalancamiento</div></div>
          <div className="metric"><div className="v">${fmtUsd(freeUsdt, 0)}</div><div className="l">USDT libre</div></div>
          <div className="metric"><div className="v">{snap.n_trades ?? 0}</div><div className="l">Trades</div></div>
        </div>
        <p className="note">"PnL total (bot)", la curva azul y el drawdown salen de la misma serie: equity − capital aportado − cierres
          de posiciones previas al bot. El "Realizado neto (ledger)" viene del historial de Binance
          {income?.hasta ? ` (sincronizado hasta ${fmtDate(income.hasta)}; los fills posteriores ya están en el equity pero aparecen en el desglose al correr el sync)` : ""}.
          {flujos.length > 0 && <> Movimientos de capital detectados en el período:{" "}
            {flujos.map((f) => `${fmtDate(new Date(f.t).toISOString())} ${f.usd >= 0 ? "+" : "−"}$${fmtUsd(Math.abs(f.usd), 0)}`).join(" · ")}
            {" "}— descontados del rendimiento, que mide solo la gestión.</>}
          {" "}Última vela: {fmtDateUtc(snap.ts)}.</p>
      </details>

      {/* ============ RENDIMIENTO ============ */}
      {series.length > 0 && (
        <div className="card">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Estrategia vs cuenta · {profName}</span>
            {pctVentana != null && <span className={pnlClass(pctVentana)} title="Rendimiento time-weighted de tu cuenta DENTRO de la ventana del gráfico">{fmtPct(pctVentana)}</span>}
            <span className="seg" style={{ marginLeft: "auto", textTransform: "none" }}>
              {([["1m", "1M"], ["3m", "3M"], ["ytd", "YTD"], ["entrada", "Entrada"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setRango(k)} aria-pressed={k === rango}>{lbl}</button>
              ))}
            </span>
          </h2>
          <PerfChart series={series} height={200} markerX={entryTs} markerLabel="Entrada" />
          <p className="note">Ambas curvas rebaseadas a 0% al inicio del período mostrado (mínimo 3 meses; YTD = desde el 1 de enero).
            Verde: la estrategia KV-9014 con el perfil{profName ? ` ${profName}` : ""} — el punto de hoy se refresca en cada vela.
            Azul: la cuenta real gestionada por el bot, hora a hora, anclada al nivel de la estrategia en la fecha de entrada.
            La curva azul es time-weighted: un depósito o un retiro cambia el tamaño de la cuenta, nunca la altura de la línea.</p>
        </div>
      )}

      {/* ============ POSICIONES ============ */}
      <div className="card">
        <h2>Corriendo ({positions.length}) · vela {fmtDateUtc(snap.ts)}
          {Object.keys(live).length > 0 && <span className="badge on" style={{ marginLeft: 8 }}>en vivo · 15 s</span>}
        </h2>
        {positions.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin posiciones abiertas</div> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Activo</th><th>Lado</th><th className="hide-sm">Monto $</th><th className="hide-sm">Entrada</th><th>Precio</th><th>uPnL</th><th>%</th>
                <th>Estado</th><th>SL</th><th>Gana desde</th><th>SL ⇄ TP</th></tr></thead>
              <tbody>
                {positions.map((p) => {
                  const price = live[p.symbol] ?? p.price;                    // en vivo (15 s) o vela
                  const esVivo = live[p.symbol] != null;
                  const notional = Math.abs(p.pos_amt * price);
                  const upnl = esVivo && p.entry_price ? p.pos_amt * (price - p.entry_price) : p.unrealized_pnl;
                  const pnlPct = p.entry_price ? (price / p.entry_price - 1) * 100 * Math.sign(p.pos_amt) : null;
                  const lv = levels[p.symbol];
                  const sideNum = p.pos_amt > 0 ? 1 : -1;
                  const distLive = lv ? (sideNum < 0 ? lv.slEff / price - 1 : 1 - lv.slEff / price) * 100 : null;
                  const sig = sigBySym.get(p.symbol);
                  const cierraSenal = sig ? sig.side !== sideNum : false; // señal en plano o contraria
                  return (
                    <tr key={p.symbol}>
                      <td><AssetName symbol={p.symbol} price={p.price} /></td>
                      <td className={`dir ${p.side === "LARGO" ? "long" : "short"}`}>{p.side}</td>
                      <td className="hide-sm">{fmtUsd(notional, 0)}</td>
                      <td className="hide-sm">{fmtUsd(p.entry_price)}</td>
                      <td title={esVivo ? "Precio en vivo (se refresca cada 15 s)" : "Precio de la última vela"}>
                        <span key={price} className={esVivo ? "tick" : undefined}>{fmtUsd(price)}</span>
                      </td>
                      <td className={pnlClass(upnl)}>{fmtUsd(upnl)}</td>
                      <td className={pnlClass(pnlPct)}>{fmtPct(pnlPct)}</td>
                      <td>
                        {cierraSenal ? (
                          <span className="badge off" title={sig && sig.side === 0
                            ? `La señal del motor pasó a plano (vela ${fmtDate(sig.bar_time)}): el bot cierra esta posición en la próxima vela`
                            : `La señal del motor se dio la vuelta: el bot cierra esta posición en la próxima vela`}>
                            cierra próx. vela
                          </span>
                        ) : distLive != null && distLive <= 0 ? (
                          <span className="badge off" title="El precio cruzó el stop dentro de la vela en curso: si se mantiene al cierre, el motor da la salida">
                            stop tocado
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>
                            {distLive != null ? `sigue · SL a ${distLive.toFixed(1)}%` : "sigue"}
                          </span>
                        )}
                      </td>
                      {lv ? (
                        <>
                          <td title={`Nivel de salida (el primero entre stop dinámico ${lv.slTrail.toFixed(4)} y canal ${lv.slChan.toFixed(4)}) · ${lv.lockedPct >= 0 ? `ya asegura +${lv.lockedPct.toFixed(1)}% frente a la entrada` : `si sale ahí, resultado ${lv.lockedPct.toFixed(1)}% frente a la entrada`}`}>
                            <b className="neg">{fmtUsd(lv.slEff)}</b>
                          </td>
                          <td title={lv.lockedPct >= 0
                            ? `El stop (${fmtUsd(lv.slEff)}) ya está más allá de la entrada: la salida queda en ganancia pase lo que pase`
                            : `Si el precio toca este nivel (entrada ${p.side === "CORTO" ? "−" : "+"} ${STRATEGY_PARAMS[p.symbol]?.am ?? "n"}×ATR), el stop dinámico cruza la entrada y la salida pasa a ser en ganancia. Calculado con el ATR actual.`}>
                            {lv.lockedPct >= 0
                              ? <b className="pos">✓ {fmtUsd(lv.slEff)}</b>
                              : <b className="pos">{fmtUsd(lv.beTrigger)}</b>}
                          </td>
                          <td>
                            <LevelBar sl={lv.slEff} best={lv.best} price={price} entry={p.entry_price}
                              breached={distLive != null && distLive <= 0} />
                          </td>
                        </>
                      ) : (
                        <><td className="muted">—</td><td className="muted">—</td><td className="muted">calculando…</td></>
                      )}
                    </tr>
                  );
                })}
                {positions.length > 1 && (() => {
                  const entryNotTot = positions.reduce((a, p) => a + Math.abs(p.pos_amt * (p.entry_price || pxOf(p))), 0);
                  const pctTot = entryNotTot ? (upnlLiveTot / entryNotTot) * 100 : null;
                  return (
                    <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
                      <td colSpan={2} style={{ textAlign: "left" }}>TOTAL</td>
                      <td>{fmtUsd(expLive, 0)}</td>
                      <td></td><td></td>
                      <td className={pnlClass(upnlLiveTot)}>{fmtUsd(upnlLiveTot)}</td>
                      <td className={pnlClass(pctTot)}>{fmtPct(pctTot)}</td>
                      <td colSpan={4}></td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
        <p className="note"><b>SL</b> = nivel donde la posición sale sola (el primero que se toque entre el stop dinámico, que
          sigue al precio, y la salida de canal) — al valor de hoy, saldría ahí. <b>Gana desde</b> = precio que el mercado
          tiene que tocar para que el stop cruce la entrada: a partir de ahí la salida queda asegurada en ganancia, y cada
          nuevo extremo asegura más (✓ = ya conseguido; la estrategia no usa take-profit fijo, deja correr con trailing).
          <b> Estado</b> = qué hará el bot en la próxima vela según la señal oficial del motor: "sigue" (con la distancia al
          stop), "stop tocado" (el precio cruzó el stop dentro de la vela en curso) o <b>"cierra próx. vela"</b> (la señal del
          motor ya está en plano o en contra: el bot manda la orden de cierre en la próxima evaluación horaria).
          Barra <b>SL ⇄ TP</b>: rojo = stop, verde = mejor precio, línea punteada = entrada, punto = precio actual.
          Niveles en vivo con velas de Binance y los parámetros del motor.</p>
      </div>

      {/* ============ RESUMEN DE LA SEMANA ============ */}
      {snaps.length > 1 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Resumen de la semana · {fEs(weekStartTs)} – {fEs(Date.now())} de {new Date().getFullYear()}</h2>
          <p style={{ fontSize: 14, lineHeight: 1.65, margin: "10px 0 0" }}>
            La cuenta {pnlSemana != null && pnlSemana >= 0 ? "ganó" : "perdió"}{" "}
            <b className={pnlClass(pnlSemana)}>{fmtUsd(pnlSemana)} ({fmtPct(pnlSemanaPct)})</b> en los últimos 7 días.
            {wAperturas.length > 0 && <> Se abrieron <b>{wAperturas.length}</b> posiciones ({wAperturas.join(", ")}).</>}
            {wCierres.length > 0 && <> Se cerraron <b>{wCierres.length}</b>: {wGan.length} ganadora{wGan.length === 1 ? "" : "s"} y{" "}
              {wPer.length} perdedora{wPer.length === 1 ? "" : "s"}, saldo realizado{" "}
              <b className={pnlClass(wRealizado)}>{fmtUsd(wRealizado)}</b>.</>}
            {wCierres.length === 0 && <> No hubo cierres en la semana.</>}
            {" "}Ahora corren <b>{positions.length}</b> posiciones con{" "}
            <b className={pnlClass(upnlLiveTot)}>{fmtUsd(upnlLiveTot)}</b> no realizado{enVivo ? " (en vivo)" : ""}.
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.65, margin: "8px 0 0" }}>
            <b>Qué esperar:</b>{" "}
            {posCierre.length > 0 && <>{posCierre.map((p) => p.symbol.replace("USDT", "")).join(", ")}{" "}
              {posCierre.length === 1 ? "sale" : "salen"} en la próxima vela por señal del motor. </>}
            {posCerca.length > 0 && <>{posCerca.map((p) => p.symbol.replace("USDT", "")).join(", ")}{" "}
              {posCerca.length === 1 ? "corre" : "corren"} a menos del 2% de su stop y{" "}
              {posCerca.length === 1 ? "podría salir" : "podrían salir"} en los próximos días si el precio no acompaña. </>}
            {posCierre.length === 0 && posCerca.length === 0 && positions.length > 0 &&
              <>Ninguna posición está en señal de cierre ni pegada a su stop. </>}
            El resto sigue con trailing: sin take-profit fijo, cada salida depende de que el precio toque su SL,
            que solo se mueve a favor.
          </p>
        </div>
      )}

      {/* ============ ACTIVIDAD RECIENTE (events) ============ */}
      <EventFeed eventos={eventos} />

      {/* ============ EN ESPERA ============ */}
      <div className="card">
        <h2>En espera de señal ({pending.length})</h2>
        {pending.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Todos los activos tienen posición abierta</div> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Activo</th><th>Precio</th><th>Corto&nbsp;&lt;</th><th>Largo&nbsp;&gt;</th><th>Proximidad</th></tr></thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.symbol}>
                    <td><AssetName symbol={s.symbol} price={s.price} /></td>
                    <td>{fmtUsd(s.price)}</td>
                    <td className="neg">{fmtUsd(s.short_trigger)}</td>
                    <td className="pos">{fmtUsd(s.long_trigger)}</td>
                    <td><TriggerGauge price={s.price} longT={s.long_trigger} shortT={s.short_trigger} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Niveles de entrada de la estrategia con el perfil {profName || "—"}. El punto indica dónde está el
          precio entre el disparo de venta (rojo) y el de compra (verde); cerca de un extremo = ruptura próxima.
          {signals[0] && <> Señales actualizadas: {fmtDate(signals[0].created_at ?? signals[0].bar_time)}.</>}</p>
      </div>

      {/* ============ COMPOSICIÓN ============ */}
      <div className="card">
        <h2>Composición de la exposición
          {enVivo && <span className="badge on" style={{ marginLeft: 8 }}>en vivo · 15 s</span>}
        </h2>
        <div className="metric-row" style={{ marginTop: 10 }}>
          <div className="metric"><div className="v">${fmtUsd(expLive, 0)}</div><div className="l">Exposición total</div></div>
          <div className="metric"><div className={`v ${pnlClass(upnlLiveTot)}`}>{fmtUsd(upnlLiveTot)}</div><div className="l">uPnL posiciones</div></div>
          <div className="metric"><div className="v">{leverage == null ? "—" : `x${leverage.toFixed(2)}`}</div><div className="l">Apalancamiento</div></div>
          <div className="metric"><div className="v">${fmtUsd(freeUsdt, 0)}</div><div className="l">USDT libre ({marginPct == null ? "—" : (100 - marginPct).toFixed(0)}%)</div></div>
        </div>
        <Donut slices={slices} />
        <p className="note">Mismos precios en vivo que la tabla "Corriendo": la torta, la exposición y el uPnL siempre coinciden
          con lo de arriba. En futuros el capital {tuyo} nunca se "gasta": el 100% permanece en USDT como colateral.
          ▲ largo (gana si sube), ▼ corto (gana si baja).</p>
      </div>
    </>
  );
}
