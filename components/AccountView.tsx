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
 * salen TODOS de la misma serie: equity(t) − capital inicial − cierres
 * heredados (posiciones previas al bot) acumulados hasta t. Por eso el número
 * grande, el gráfico y el drawdown siempre cuadran entre sí y llegan a la
 * última vela.
 */
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import Donut from "@/components/Donut";
import TriggerGauge from "@/components/TriggerGauge";
import LevelBar from "@/components/LevelBar";
import AssetName from "@/components/AssetName";
import PerfChart from "@/components/PerfChart";
import { computeLevels, Levels } from "@/lib/levels";
import { attributeIncome, Attribution } from "@/lib/pnl";

type Snap = {
  ts: string; bar_time: string; equity: number; wallet_balance: number; unrealized_pnl: number;
  margin_used: number; exposure_notional: number; dd_pct: number; realized_cum: number;
  start_equity: number; n_trades: number;
};
type Pos = { id: number; symbol: string; side: string; pos_amt: number; price: number; entry_price: number; unrealized_pnl: number };
type Trade = { id: number; ts: string; symbol: string; side: string; profit: number };
type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string; created_at: string };

const variantOf = (atr: number | null | undefined) =>
  atr == null ? "default" : `atr${Number.isInteger(Number(atr)) ? parseInt(String(atr)) : atr}`;

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
  const [levels, setLevels] = useState<Record<string, Levels | null>>({});
  const [bench, setBench] = useState<{ date: string; equity_index: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const tuyo = esAdmin ? "del cliente" : "tuyo";

  useEffect(() => {
    if (!client?.id) return;
    let alive = true;
    (async () => {
      const sb = supabaseBrowser();
      const variant = variantOf(client?.risk_profiles?.atr_mult);
      const { data: s } = await sb.from("account_snapshots").select("*")
        .eq("client_id", client.id).order("ts", { ascending: true }).limit(6000);
      const snapRows = (s ?? []) as Snap[];
      const latest = snapRows[snapRows.length - 1];
      const [b, sig, t, p, inc] = await Promise.all([
        client.risk_profile_id
          ? sb.from("strategy_benchmark").select("date, equity_index").eq("profile_id", client.risk_profile_id).order("date", { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        sb.from("strategy_signals").select("*").eq("variant", variant).order("bar_time", { ascending: false }).limit(8),
        sb.from("trades").select("id, ts, symbol, side, profit").eq("client_id", client.id).order("ts", { ascending: false }).limit(300),
        latest?.bar_time
          ? sb.from("positions").select("*").eq("client_id", client.id).eq("bar_time", latest.bar_time)
          : Promise.resolve({ data: [] as any[] }),
        snapRows[0]?.ts
          ? sb.from("account_income").select("income_type, income, ts, symbol").eq("client_id", client.id).gte("ts", snapRows[0].ts).limit(5000)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (!alive) return;
      setSnaps(snapRows);
      setBench((b as any).data ?? []);
      setSignals(((sig as any).data ?? []) as Signal[]);
      setTrades(((t as any).data ?? []) as Trade[]);
      setPositions(dedupeBySymbol((((p as any).data ?? []) as Pos[]).filter((r) => r.pos_amt !== 0)));
      setIncome(attributeIncome(((inc as any).data ?? []), ((t as any).data ?? [])));
      setLoading(false);
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

  if (loading) return <div className="muted">Cargando…</div>;

  const snap = snaps[snaps.length - 1] ?? null;
  if (!snap) return (
    <div className="card"><h2>Sin datos aún</h2>
      <p className="note">Cuando el bot procese la cuenta (cada hora) aparecerán aquí balance y posiciones.</p>
    </div>
  );

  // ---- serie del BOT: equity − inicial − heredado acumulado (una sola fuente
  // de verdad para el número grande, la curva azul y el drawdown) ----
  const hf = (income?.heredadoFills ?? []).map((h) => ({ t: new Date(h.ts).getTime(), usd: h.usd }))
    .sort((a, b) => a.t - b.t);
  const heredadoHasta = (t: number) => hf.reduce((a, h) => a + (h.t <= t ? h.usd : 0), 0);
  const start = snap.start_equity || 0;
  const botSeries = snaps.map((s) => {
    const t = new Date(s.ts).getTime();
    return { x: t, pnl: s.equity - start - heredadoHasta(t) };
  });
  const pnlAbs = botSeries.length ? botSeries[botSeries.length - 1].pnl : null;
  const totalPct = start && pnlAbs != null ? (pnlAbs / start) * 100 : null;
  let peak = -Infinity, ddBot = 0;
  for (const p of botSeries) {
    const eq = start + p.pnl;
    peak = Math.max(peak, eq);
    if (peak > 0) ddBot = Math.min(ddBot, (eq / peak - 1) * 100);
  }
  const cuentaAbs = start ? snap.equity - start : null;

  const leverage = snap.equity ? snap.exposure_notional / snap.equity : null;
  const freeUsdt = Math.max(0, snap.equity - (snap.margin_used ?? 0));
  const marginPct = snap.equity ? ((snap.margin_used ?? 0) / snap.equity) * 100 : null;
  const slices = positions.map((p) => ({ label: p.symbol, value: Math.abs(p.pos_amt * p.price), side: p.side }));
  const openSyms = new Set(positions.map((p) => p.symbol));
  const pending = signals.filter((s) => !openSyms.has(s.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const profName: string = client?.risk_profiles?.name ?? "";

  // ---- rendimiento desde la entrada: ambas curvas parten de 0% ese día y
  // llegan a la última vela disponible (cuenta: cada hora; estrategia: diaria).
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;
  const benchAll = bench.map((b) => ({ x: new Date(b.date + "T00:00:00Z").getTime(), y: b.equity_index }));
  let stratPts: { x: number; y: number }[] = [];
  if (entryTs != null && benchAll.length) {
    let base = benchAll[0].y;
    for (const p of benchAll) if (p.x <= entryTs) base = p.y;
    stratPts = benchAll.filter((p) => p.x >= entryTs - 86400e3).map((p) => ({ x: p.x, y: (p.y / base - 1) * 100 }));
  }
  const clientPts = start ? botSeries.map((p) => ({ x: p.x, y: (p.pnl / start) * 100 })) : [];
  const series = [
    { label: "Estrategia " + profName, color: "#3d996f", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: esAdmin ? "Cuenta del cliente (bot)" : "Tu cuenta (bot)", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);

  return (
    <>
      {/* ============ LO IMPORTANTE ============ */}
      <div className="metric-row">
        <div className="metric"><div className="v">${fmtUsd(snap.equity)}</div><div className="l">Equity</div></div>
        <div className="metric"><div className={`v ${pnlClass(pnlAbs)}`}>{fmtUsd(pnlAbs)}</div><div className="l">PnL total (bot)</div></div>
        <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">PnL total %</div></div>
        <div className="metric"><div className={`v ${pnlClass(snap.unrealized_pnl)}`}>{fmtUsd(snap.unrealized_pnl)}</div><div className="l">No realizado (posiciones)</div></div>
        <div className="metric"><div className={`v ${pnlClass(ddBot)}`}>{fmtPct(ddBot, 1)}</div><div className="l">Drawdown (bot)</div></div>
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
            <div className="metric"><div className={`v ${pnlClass(cuentaAbs)}`}>{fmtUsd(cuentaAbs)}</div><div className="l">PnL cuenta completa</div></div>
          )}
          <div className="metric"><div className="v">${fmtUsd(snap.exposure_notional, 0)}</div><div className="l">Exposición</div></div>
          <div className="metric"><div className="v">${fmtUsd(snap.margin_used, 0)}</div><div className="l">Margen usado ({marginPct?.toFixed(1)}%)</div></div>
          <div className="metric"><div className="v">{leverage == null ? "—" : `x${leverage.toFixed(2)}`}</div><div className="l">Apalancamiento</div></div>
          <div className="metric"><div className="v">${fmtUsd(freeUsdt, 0)}</div><div className="l">USDT libre</div></div>
          <div className="metric"><div className="v">{snap.n_trades ?? 0}</div><div className="l">Trades</div></div>
        </div>
        <p className="note">"PnL total (bot)", la curva azul y el drawdown salen de la misma serie: equity − capital inicial − cierres
          de posiciones previas al bot. El "Realizado neto (ledger)" viene del historial de Binance
          {income?.hasta ? ` (sincronizado hasta ${fmtDate(income.hasta)}; los fills posteriores ya están en el equity pero aparecen en el desglose al correr el sync)` : ""}.
          Última vela: {fmtDate(snap.ts)}.</p>
      </details>

      {/* ============ RENDIMIENTO ============ */}
      {series.length > 0 && (
        <div className="card">
          <h2>Estrategia vs cuenta · {profName} · desde la entrada
            {totalPct != null && <span className={pnlClass(totalPct)} style={{ marginLeft: 8 }}>{fmtPct(totalPct)}</span>}
          </h2>
          <PerfChart series={series} height={200} markerX={entryTs} markerLabel="Entrada" />
          <p className="note">Ambas curvas parten de 0% en la fecha de entrada. Verde: la estrategia KV-9014 con el perfil
            {profName ? ` ${profName}` : ""} (diaria, se actualiza al cierre de cada día). Azul: la cuenta real gestionada por el bot,
            hora a hora hasta la última vela.</p>
        </div>
      )}

      {/* ============ POSICIONES ============ */}
      <div className="card">
        <h2>Corriendo ({positions.length}) · vela {fmtDate(snap.ts)}</h2>
        {positions.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin posiciones abiertas</div> : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Activo</th><th>Lado</th><th>Monto $</th><th>Entrada</th><th>Precio</th><th>uPnL</th><th>%</th>
                <th>Sale en</th><th>Dist.</th><th>Asegura</th><th>SL ⇄ TP</th></tr></thead>
              <tbody>
                {positions.map((p) => {
                  const notional = Math.abs(p.pos_amt * p.price);
                  const pnlPct = p.entry_price ? (p.price / p.entry_price - 1) * 100 * Math.sign(p.pos_amt) : null;
                  const lv = levels[p.symbol];
                  return (
                    <tr key={p.symbol}>
                      <td><AssetName symbol={p.symbol} price={p.price} /></td>
                      <td className={p.side === "LARGO" ? "pos" : "neg"}>{p.side}</td>
                      <td>{fmtUsd(notional, 0)}</td>
                      <td>{fmtUsd(p.entry_price)}</td>
                      <td>{fmtUsd(p.price)}</td>
                      <td className={pnlClass(p.unrealized_pnl)}>{fmtUsd(p.unrealized_pnl)}</td>
                      <td className={pnlClass(pnlPct)}>{fmtPct(pnlPct)}</td>
                      {lv ? (
                        <>
                          <td><b>{fmtUsd(lv.slEff)}</b></td>
                          <td className="muted">{lv.distPct.toFixed(1)}%</td>
                          <td className={pnlClass(lv.lockedPct)}>{lv.lockedPct >= 0 ? `+${lv.lockedPct.toFixed(1)}%` : `${lv.lockedPct.toFixed(1)}%`}</td>
                          <td title={`Stop dinámico ${lv.slTrail} · salida canal ${lv.slChan} · mejor precio ${lv.best}`}>
                            <LevelBar sl={lv.slEff} best={lv.best} price={lv.price} entry={p.entry_price} />
                          </td>
                        </>
                      ) : (
                        <td colSpan={4} className="muted">calculando…</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Cada posición sale sola en el nivel <b>"Sale en"</b> (el primero que se toque entre el stop dinámico,
          que sigue al precio, y la salida de canal). <b>"Asegura"</b> = lo que ese nivel ya protege frente a la entrada
          (verde = ganancia asegurada aunque el precio se dé la vuelta). Slider <b>SL ⇄ TP</b>: rojo = salida por stop,
          verde = mejor precio alcanzado (donde se va tomando ganancia), línea punteada = entrada, punto = precio actual.
          Niveles en vivo con velas de Binance y los parámetros del motor.</p>
      </div>

      {/* ============ EN ESPERA ============ */}
      <div className="card">
        <h2>En espera de señal ({pending.length})</h2>
        {pending.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Todos los activos tienen posición abierta</div> : (
          <div style={{ overflowX: "auto" }}>
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
        <h2>Composición de la exposición</h2>
        <Donut slices={slices} />
        <p className="note" style={{ marginTop: 12 }}>
          Margen en uso: ${fmtUsd(snap.margin_used ?? 0, 0)} ({marginPct?.toFixed(1)}% del equity) · USDT libre: ${fmtUsd(freeUsdt, 0)}
        </p>
        <p className="note">En futuros el capital {tuyo} nunca se "gasta": el 100% permanece en USDT como colateral.
          El gráfico muestra la exposición nocional por activo; ▲ largo (gana si sube), ▼ corto (gana si baja).</p>
      </div>
    </>
  );
}
