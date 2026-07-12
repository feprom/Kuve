"use client";
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
  margin_used: number; exposure_notional: number; open_positions: number; dd_pct: number;
  realized_cum: number; start_equity: number; n_trades: number;
};
type Pos = { id: number; symbol: string; side: string; pos_amt: number; price: number; entry_price: number; unrealized_pnl: number };
type Trade = { id: number; ts: string; symbol: string; side: string; profit: number };
type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string; created_at: string };

/** Signal variant for a profile: null atr_mult -> 'default', 10 -> 'atr10'. */
const variantOf = (atr: number | null | undefined) =>
  atr == null ? "default" : `atr${Number.isInteger(Number(atr)) ? parseInt(String(atr)) : atr}`;

/** The bot may write more than one row per symbol for the same bar — keep
 *  only the most recent row per symbol. */
function dedupeBySymbol(rows: Pos[]): Pos[] {
  const seen = new Map<string, Pos>();
  for (const r of rows) {
    const prev = seen.get(r.symbol);
    if (!prev || r.id > prev.id) seen.set(r.symbol, r);
  }
  return Array.from(seen.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export default function Dashboard() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [income, setIncome] = useState<Attribution | null>(null);
  const [levels, setLevels] = useState<Record<string, Levels | null>>({});
  const [client, setClient] = useState<any>(null);
  const [bench, setBench] = useState<{ date: string; equity_index: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients").select("*, risk_profiles(atr_mult, name)")
        .eq("auth_uid", user.id).single();
      setClient(c);
      if (c) {
        const variant = variantOf((c as any).risk_profiles?.atr_mult);
        // Historial completo primero: define la ultima vela y la fecha de entrada.
        const { data: s } = await sb.from("account_snapshots").select("*")
          .eq("client_id", c.id).order("ts", { ascending: true }).limit(6000);
        const snapRows = (s ?? []) as Snap[];
        const latest = snapRows[snapRows.length - 1];
        const [b, sig, t, p, inc] = await Promise.all([
          c.risk_profile_id
            ? sb.from("strategy_benchmark").select("date, equity_index").eq("profile_id", c.risk_profile_id).order("date", { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
          sb.from("strategy_signals").select("*").eq("variant", variant).order("bar_time", { ascending: false }).limit(8),
          sb.from("trades").select("id, ts, symbol, side, profit").eq("client_id", c.id).order("ts", { ascending: false }).limit(300),
          latest?.bar_time
            ? sb.from("positions").select("*").eq("client_id", c.id).eq("bar_time", latest.bar_time)
            : Promise.resolve({ data: [] as any[] }),
          snapRows[0]?.ts
            ? sb.from("account_income").select("income_type, income, ts, symbol").eq("client_id", c.id).gte("ts", snapRows[0].ts).limit(5000)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        setSnaps(snapRows);
        setBench((b as any).data ?? []);
        setSignals(((sig as any).data ?? []) as Signal[]);
        setTrades(((t as any).data ?? []) as Trade[]);
        setPositions(dedupeBySymbol((((p as any).data ?? []) as Pos[]).filter((r) => r.pos_amt !== 0)));
        setIncome(attributeIncome(((inc as any).data ?? []), ((t as any).data ?? [])));
      }
      setLoading(false);
    })();
  }, []);

  // Niveles de salida (SL dinamico + canal + mejor precio) por posicion abierta,
  // calculados en el navegador con velas de Binance (mismas reglas del motor).
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
  }, [positions, trades]);

  if (loading) return <div className="muted">Cargando…</div>;

  const snap = snaps[snaps.length - 1] ?? null;
  // PnL de la CUENTA (equity - capital inicial) y PnL DEL BOT (atribuido).
  const cuentaAbs = snap?.start_equity ? snap.equity - snap.start_equity : null;
  const realizadoBot = income ? income.realizadoNeto : null;
  const pnlAbs = income != null && snap ? (realizadoBot as number) + (snap.unrealized_pnl ?? 0) : cuentaAbs;
  const totalPct = snap?.start_equity && pnlAbs != null ? (pnlAbs / snap.start_equity) * 100 : null;
  const leverage = snap?.equity ? snap.exposure_notional / snap.equity : null;
  const freeUsdt = snap ? Math.max(0, snap.equity - (snap.margin_used ?? 0)) : null;
  const marginPct = snap && snap.equity ? ((snap.margin_used ?? 0) / snap.equity) * 100 : null;
  const slices = positions.map((p) => ({ label: p.symbol, value: Math.abs(p.pos_amt * p.price), side: p.side }));
  const openSyms = new Set(positions.map((p) => p.symbol));
  const pending = signals.filter((s) => !openSyms.has(s.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const profName: string = client?.risk_profiles?.name ?? "";

  // Rendimiento DESDE TU ENTRADA: ambas curvas parten de 0% en la fecha de entrada.
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;
  const benchAll = bench.map((b) => ({ x: new Date(b.date + "T00:00:00Z").getTime(), y: b.equity_index }));
  let stratPts: { x: number; y: number }[] = [];
  if (entryTs != null && benchAll.length) {
    let base = benchAll[0].y;
    for (const p of benchAll) if (p.x <= entryTs) base = p.y;
    stratPts = benchAll.filter((p) => p.x >= entryTs - 86400e3).map((p) => ({ x: p.x, y: (p.y / base - 1) * 100 }));
  }
  const clientPts: { x: number; y: number }[] = snap?.start_equity
    ? snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: (s.equity / snap.start_equity - 1) * 100 }))
    : [];
  const stratSeries = [
    { label: "Estrategia " + profName, color: "#3d996f", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: "Tu cuenta", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);
  const stratLast = stratPts.length ? stratPts[stratPts.length - 1].y : null;

  return (
    <>
      <div className="pagetitle">{client?.name || "Resumen"}
        {client && <span className={`badge ${client.enabled ? "on" : "off"}`}>{client.enabled ? "ACTIVO" : "PARADO"}</span>}
      </div>

      {!snap ? (
        <div className="card"><h2>Sin datos aún</h2>
          <p className="note">Cuando el bot procese tu cuenta (cada hora), verás aquí tu balance y posiciones.
          Comprueba en Perfil que tus claves de Binance están configuradas y el bot activado.</p>
        </div>
      ) : (
        <>
          <div className="metric-row">
            <div className="metric"><div className="v">${fmtUsd(snap.equity)}</div><div className="l">Equity (balance + PnL abierto)</div></div>
            <div className="metric"><div className={`v ${pnlClass(pnlAbs)}`}>{fmtUsd(pnlAbs)}</div><div className="l">PnL total (bot)</div></div>
            <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">PnL total %</div></div>
            {income && (
              <div className="metric"><div className={`v ${pnlClass(realizadoBot)}`}>{fmtUsd(realizadoBot)}</div><div className="l">Realizado neto</div></div>
            )}
            <div className="metric"><div className={`v ${pnlClass(snap.unrealized_pnl)}`}>{fmtUsd(snap.unrealized_pnl)}</div><div className="l">No realizado (posiciones)</div></div>
            <div className="metric"><div className="v">{fmtPct(snap.dd_pct, 1)}</div><div className="l">Drawdown</div></div>
            <div className="metric"><div className="v">${fmtUsd(snap.exposure_notional, 0)}</div><div className="l">Exposición</div></div>
            <div className="metric"><div className="v">{leverage == null ? "—" : `x${leverage.toFixed(2)}`}</div><div className="l">Apalancamiento en uso</div></div>
            <div className="metric"><div className="v">{snap.n_trades ?? 0}</div><div className="l">Trades</div></div>
          </div>
          {income && (
            <div className="metric-row">
              <div className="metric"><div className={`v ${pnlClass(income.mercado)}`}>{fmtUsd(income.mercado)}</div><div className="l">Mercado (cierres)</div></div>
              <div className="metric"><div className={`v ${pnlClass(income.comisiones)}`}>{fmtUsd(income.comisiones)}</div><div className="l">Comisiones</div></div>
              <div className="metric"><div className={`v ${pnlClass(income.funding)}`}>{fmtUsd(income.funding)}</div><div className="l">Funding</div></div>
              {income.heredado !== 0 && (
                <div className="metric"><div className="v muted">{fmtUsd(income.heredado)}</div><div className="l">Previas al bot (no cuenta)</div></div>
              )}
              {cuentaAbs != null && (
                <div className="metric"><div className={`v ${pnlClass(cuentaAbs)}`}>{fmtUsd(cuentaAbs)}</div><div className="l">PnL cuenta completa</div></div>
              )}
            </div>
          )}
          <p className="note"><b>"PnL total (bot)"</b> mide solo lo que el bot operó desde tu ingreso: mercado + comisiones + funding
            + no realizado. Si tu cuenta tenía posiciones previas, sus cierres se muestran aparte y no cuentan.
            {income?.hasta ? ` Costos sincronizados hasta ${fmtDate(income.hasta)}.` : ""}</p>

          {stratSeries.length > 0 && (
            <div className="card">
              <h2>Tu estrategia · {profName} · desde tu entrada
                {stratLast != null && <span className={pnlClass(stratLast)} style={{ marginLeft: 8 }}>{fmtPct(stratLast)}</span>}
              </h2>
              <PerfChart series={stratSeries} height={180}
                markerX={entryTs} markerLabel="Tu entrada" />
              <p className="note">Ambas curvas parten de 0% en tu fecha de entrada. Verde: la estrategia KV-9014 con tu perfil,
                re-basada a ese día. Azul: tu cuenta real (equity vs capital inicial).</p>
            </div>
          )}

          <div className="card">
            <h2>Posiciones abiertas ({positions.length})</h2>
            {positions.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin posiciones abiertas</div> : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Activo</th><th>Lado</th><th>Monto $</th><th>Entrada</th><th>Precio</th><th>uPnL</th><th>%</th>
                    <th>Sale en</th><th>Asegura</th><th>SL ⇄ TP</th></tr></thead>
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
                              <td className={pnlClass(lv.lockedPct)}>{lv.lockedPct >= 0 ? `+${lv.lockedPct.toFixed(1)}%` : `${lv.lockedPct.toFixed(1)}%`}</td>
                              <td title={`Stop dinámico ${lv.slTrail} · salida canal ${lv.slChan} · mejor precio ${lv.best}`}>
                                <LevelBar sl={lv.slEff} best={lv.best} price={lv.price} entry={p.entry_price} />
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} className="muted">calculando…</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="note">Cada posición sale sola en el nivel "Sale en" (stop dinámico que sigue al precio, o salida de canal —
              el primero que se toque). "Asegura" = lo que ese nivel ya protege frente a tu entrada: en verde, ganancia asegurada
              aunque el precio se dé la vuelta. En el slider <b>SL ⇄ TP</b>: rojo = salida por stop, verde = mejor precio alcanzado
              (donde se va tomando ganancia), línea punteada = tu entrada, punto = precio actual. Calculado en vivo con velas de Binance.</p>
          </div>

          <div className="card">
            <h2>En espera de señal ({pending.length})</h2>
            {pending.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Todos los activos tienen posición abierta</div> : (
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
            )}
            <p className="note">El punto indica dónde está el precio entre el disparo de venta (rojo) y el de compra (verde). Cerca de un extremo = ruptura próxima.</p>
            {signals[0] && (
              <p className="note">Señales actualizadas: {fmtDate(signals[0].created_at ?? signals[0].bar_time)} (tu hora local)</p>
            )}
          </div>

          <div className="card">
            <h2>Composición de la exposición</h2>
            <Donut slices={slices} />
            {freeUsdt != null && (
              <p className="note" style={{ marginTop: 12 }}>
                Margen en uso: ${fmtUsd(snap.margin_used ?? 0, 0)} ({marginPct?.toFixed(1)}% del equity) · USDT libre: ${fmtUsd(freeUsdt, 0)}
              </p>
            )}
            <p className="note">En futuros tu capital nunca se "gasta": el 100% permanece en USDT como colateral.
              El gráfico muestra la exposición nocional por activo; ▲ largo (ganas si sube), ▼ corto (ganas si baja).</p>
          </div>

        </>
      )}
    </>
  );
}
