"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import PerfChart from "@/components/PerfChart";
import AssetName from "@/components/AssetName";
import TriggerGauge from "@/components/TriggerGauge";
import { computeLevels, Levels } from "@/lib/levels";

type Client = {
  id: string; name: string; email: string | null; mode: string; enabled: boolean;
  activation_requested: boolean; key_status: string; created_at: string;
  risk_profile_id: number | null;
  risk_profiles: { name: string; atr_mult: number | null } | null;
};
type Profile = { id: number; name: string };
type Snap = {
  ts: string; bar_time: string; equity: number; wallet_balance: number; unrealized_pnl: number;
  margin_used: number; exposure_notional: number; dd_pct: number; realized_cum: number;
  start_equity: number; n_trades: number;
};
type Bench = { date: string; equity_index: number };
type Pos = { id: number; symbol: string; side: string; pos_amt: number; price: number; entry_price: number; unrealized_pnl: number };
type Trade = { id: number; ts: string; symbol: string; side: string; profit: number; commission: number; cum: number; qty: number | null; price: number | null };
type Order = { id: number; ts: string; symbol: string; side: string; qty: number; status: string; reduce_only: boolean; error: string | null };
type Evt = { id: number; ts: string; kind: string; level: string; detail: any };
type Report = {
  period_start: string; period_end: string; start_equity: number; end_equity: number;
  pnl_abs: number; pnl_pct: number; realized: number; n_trades: number; max_dd_pct: number;
};

type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string; created_at: string };
type Income = {
  mercado: number;        // cierres atribuibles al bot
  heredado: number;       // cierres de posiciones previas al bot (excluidos del PnL del bot)
  comisiones: number;     // comisiones de fills del bot
  funding: number;        // funding de las posiciones gestionadas
  transfers: number;
  hasta: string | null;
};

type Tab = "resumen" | "posiciones" | "historial" | "eventos" | "cortes";

/** Variante de señal según el perfil: atr_mult null -> 'default', 10 -> 'atr10'. */
const variantOf = (atr: number | null | undefined) =>
  atr == null ? "default" : `atr${Number.isInteger(Number(atr)) ? parseInt(String(atr)) : atr}`;

/** First day of next month, 00:00 UTC. */
function nextCutoff(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
}

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

export default function AdminClientDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [bench, setBench] = useState<Bench[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [levels, setLevels] = useState<Record<string, Levels | null>>({});
  const [income, setIncome] = useState<Income | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("resumen");
  const [histTab, setHistTab] = useState<"trades" | "orders">("trades");
  const [fSymbol, setFSymbol] = useState("all");
  const [fSide, setFSide] = useState("all");

  async function load() {
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { data: adm } = await sb.from("admin_users").select("auth_uid").eq("auth_uid", user.id);
    if (!adm?.length) { setIsAdmin(false); setLoading(false); return; }
    setIsAdmin(true);

    const [c, p] = await Promise.all([
      sb.from("clients").select("*, risk_profiles(name, atr_mult)").eq("id", id).single(),
      sb.from("risk_profiles").select("id, name").order("id"),
    ]);
    const cli = c.data as any;
    setClient(cli);
    setProfiles(p.data ?? []);

    // Fetch the account history first so we know the exact bar_time of the
    // latest snapshot — positions are then pinned to that same bar, so the
    // "Resumen" and "Posiciones" tabs can never disagree about which vela
    // they're showing.
    const s = await sb.from("account_snapshots")
      .select("ts, bar_time, equity, wallet_balance, unrealized_pnl, margin_used, exposure_notional, dd_pct, realized_cum, start_equity, n_trades")
      .eq("client_id", id).order("ts", { ascending: true }).limit(6000);
    const snapRows = (s.data ?? []) as Snap[];
    const lastSnap = snapRows[snapRows.length - 1];

    const variant = variantOf(cli?.risk_profiles?.atr_mult);
    const [b, pos, t, o, e, r, sig, inc] = await Promise.all([
      cli?.risk_profile_id
        ? sb.from("strategy_benchmark").select("date, equity_index").eq("profile_id", cli.risk_profile_id).order("date", { ascending: true })
        : Promise.resolve({ data: [] as Bench[] }),
      lastSnap?.bar_time
        ? sb.from("positions").select("id, symbol, side, pos_amt, price, entry_price, unrealized_pnl")
            .eq("client_id", id).eq("bar_time", lastSnap.bar_time).order("id", { ascending: false })
        : Promise.resolve({ data: [] as Pos[] }),
      sb.from("trades").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(300),
      sb.from("orders").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(300),
      sb.from("events").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(150),
      sb.from("client_monthly_reports").select("*").eq("client_id", id).order("period_start", { ascending: false }),
      sb.from("strategy_signals").select("*").eq("variant", variant).order("bar_time", { ascending: false }).limit(8),
      snapRows[0]?.ts
        ? sb.from("account_income").select("income_type, income, ts, symbol").eq("client_id", id).gte("ts", snapRows[0].ts).limit(5000)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    // Realizado según el LEDGER de Binance, ATRIBUIDO AL BOT: un cierre cuenta
    // solo si el bot registró antes la apertura de esa posición (trade con
    // profit=0 del mismo símbolo, al menos 2 min antes del fill). Los cierres
    // de posiciones previas al bot (heredadas/adoptadas) se separan en
    // "heredado" y NO entran al PnL del bot.
    {
      const rows = ((inc as any).data ?? []) as { income_type: string; income: number; ts: string; symbol: string | null }[];
      const botTrades = ((t as any).data ?? []) as Trade[];
      const opensBefore = (sym: string | null, ts: string, marginMs: number) =>
        !!sym && botTrades.some((tr) => tr.symbol === sym && !tr.profit && new Date(tr.ts).getTime() < new Date(ts).getTime() - marginMs);
      const nearTrade = (sym: string | null, ts: string, winMs: number) =>
        !!sym && botTrades.some((tr) => tr.symbol === sym && Math.abs(new Date(tr.ts).getTime() - new Date(ts).getTime()) <= winMs);
      let mercado = 0, heredado = 0, comisiones = 0, funding = 0, transfers = 0;
      for (const x of rows) {
        const v = Number(x.income || 0);
        if (x.income_type === "REALIZED_PNL") {
          if (opensBefore(x.symbol, x.ts, 120e3)) mercado += v; else heredado += v;
        } else if (x.income_type === "COMMISSION") {
          if (nearTrade(x.symbol, x.ts, 300e3) || opensBefore(x.symbol, x.ts, 120e3)) comisiones += v;
        } else if (x.income_type === "FUNDING_FEE") funding += v;
        else if (x.income_type === "TRANSFER") transfers += v;
      }
      // Sin filas en el ledger (sync aun no corrido para este cliente) ->
      // income = null y la UI cae al contador del bot en vez de mostrar ceros.
      setIncome(rows.length ? { mercado, heredado, comisiones, funding, transfers,
        hasta: rows.map((x) => x.ts).sort().slice(-1)[0] } : null);
    }
    setSignals(((sig as any).data ?? []) as Signal[]);
    setSnaps(snapRows);
    setBench((b as any).data ?? []);
    setPositions(dedupeBySymbol(((pos as any).data ?? []).filter((row: Pos) => row.pos_amt !== 0)));
    setTrades(t.data ?? []);
    setOrders(o.data ?? []);
    setEvents(e.data ?? []);
    setReports(r.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Niveles de salida (SL dinámico + canal) por posición abierta, con velas de
  // Binance en el navegador. La fecha de entrada se toma del último trade de
  // apertura registrado para ese símbolo.
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

  async function toggleClient() {
    if (!client) return;
    const enable = !client.enabled;
    if (enable && !confirm("¿Activar el bot para este cliente? Empezará a operar en la próxima vela.")) return;
    if (!enable && !confirm("¿Pausar este cliente? Sus posiciones se gestionarán según su modo de desactivación.")) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("admin_toggle_client", { p_client_id: id, p_enabled: enable });
    if (error) alert(error.message);
    await load(); setBusy(false);
  }

  async function changeProfile(pid: number) {
    if (!pid) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("admin_set_profile", { p_client_id: id, p_risk_profile_id: pid });
    if (error) alert(error.message);
    await load(); setBusy(false);
  }

  if (isAdmin === false) return <div className="card"><p className="note">No tienes permisos de administrador.</p></div>;
  if (loading || !client) return <div className="muted">Cargando…</div>;

  const last = snaps[snaps.length - 1];
  // PnL de la CUENTA (equity - capital inicial): incluye tambien lo heredado.
  const cuentaAbs = last?.start_equity ? last.equity - last.start_equity : null;
  // PnL DEL BOT: solo operaciones abiertas/gestionadas por el bot desde su inicio.
  const realizadoBot = income ? income.mercado + income.comisiones + income.funding : null;
  const pnlAbs = income != null && last ? (realizadoBot as number) + (last.unrealized_pnl ?? 0) : cuentaAbs;
  const totalPct = last?.start_equity && pnlAbs != null ? (pnlAbs / last.start_equity) * 100 : null;

  const stratPts = bench.map((b) => ({ x: new Date(b.date + "T00:00:00Z").getTime(), y: b.equity_index - 100 }));
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;
  let clientPts: { x: number; y: number }[] = [];
  if (entryTs != null && last?.start_equity) {
    let anchor = 0;
    for (const p of stratPts) if (p.x <= entryTs) anchor = p.y;
    clientPts = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: anchor + (s.equity / last.start_equity - 1) * 100 }));
  }
  const series = [
    { label: `Estrategia ${client.risk_profiles?.name ?? ""}`.trim(), color: "#3d996f", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: "Cuenta del cliente", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);

  const symbols = Array.from(new Set([...trades.map((t) => t.symbol), ...orders.map((o) => o.symbol)].filter(Boolean))).sort();
  const ftrades = trades.filter((t) => (fSymbol === "all" || t.symbol === fSymbol) && (fSide === "all" || t.side === fSide));
  const forders = orders.filter((o) => (fSymbol === "all" || o.symbol === fSymbol) && (fSide === "all" || o.side === fSide));

  function exportCsv() {
    const rows: string[][] = histTab === "trades"
      ? [["fecha", "activo", "operacion", "cantidad", "precio", "profit", "comision", "acumulado"],
         ...ftrades.map((t) => [t.ts, t.symbol ?? "", t.side ?? "", String(t.qty ?? ""),
           String(t.price ?? ""), String(t.profit ?? ""), String(t.commission ?? ""), String(t.cum ?? "")])]
      : [["fecha", "activo", "lado", "cantidad", "reduce_only", "estado", "error"],
         ...forders.map((o) => [o.ts, o.symbol, o.side, String(o.qty), String(o.reduce_only), o.status, o.error ?? ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `kuve_${(client?.name || id).replace(/\s+/g, "_")}_${histTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cutoff = nextCutoff();

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href="/admin" className="muted" style={{ fontSize: 13 }}>← Volver a administración</Link>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{client.name || id.slice(0, 8)}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{client.email ?? "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={`badge ${client.enabled ? "on" : "off"}`}>{client.enabled ? "ON" : "OFF"}</span>
            {client.activation_requested && !client.enabled && <span className="badge on">SOLICITA ALTA</span>}
            {client.key_status !== "valid" && <span className="badge neutral">sin claves</span>}
            {client.mode === "testnet" && <span className="badge neutral">testnet</span>}
          </div>
        </div>

        <div className="muted" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 12.5 }}>
          <span>Ingreso: {new Date(client.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</span>
          <span>Próximo corte: {cutoff.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })} 00:00 UTC</span>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "flex-end" }}>
          <label className="field" style={{ marginBottom: 0, minWidth: 200, flex: "1 1 200px" }}>Perfil de riesgo
            <select value={client.risk_profile_id ?? ""} disabled={busy}
              onChange={(e) => changeProfile(Number(e.target.value))}>
              <option value="" disabled>Sin perfil</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {client.enabled ? (
            <button className="btn-mini pause" disabled={busy} onClick={toggleClient}>⏸ Pausar</button>
          ) : (
            <button className="btn-mini play" disabled={busy || client.key_status !== "valid" || !client.risk_profile_id}
              title={client.key_status !== "valid" ? "Sin claves válidas" : !client.risk_profile_id ? "Sin perfil de riesgo" : "Activar"}
              onClick={toggleClient}>▶ Activar</button>
          )}
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "resumen" ? "active" : ""}`} onClick={() => setTab("resumen")}>Resumen</div>
        <div className={`tab ${tab === "posiciones" ? "active" : ""}`} onClick={() => setTab("posiciones")}>Posiciones</div>
        <div className={`tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>Historial</div>
        <div className={`tab ${tab === "eventos" ? "active" : ""}`} onClick={() => setTab("eventos")}>Eventos</div>
        <div className={`tab ${tab === "cortes" ? "active" : ""}`} onClick={() => setTab("cortes")}>Cortes</div>
      </div>

      {tab === "resumen" && (
        !last ? <div className="card"><p className="note">Sin datos aún para este cliente.</p></div> : (
          <>
            <div className="metric-row">
              <div className="metric"><div className="v">${fmtUsd(last.equity)}</div><div className="l">Equity</div></div>
              <div className="metric"><div className={`v ${pnlClass(pnlAbs)}`}>{fmtUsd(pnlAbs)}</div><div className="l">PnL total (bot)</div></div>
              <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">PnL total %</div></div>
              {income ? (
                <div className="metric"><div className={`v ${pnlClass(realizadoBot)}`}>{fmtUsd(realizadoBot)}</div><div className="l">Realizado neto (bot)</div></div>
              ) : (
                <div className="metric"><div className={`v ${pnlClass(last.realized_cum)}`}>{fmtUsd(last.realized_cum)}</div><div className="l">Realizado (bot)</div></div>
              )}
              <div className="metric"><div className={`v ${pnlClass(last.unrealized_pnl)}`}>{fmtUsd(last.unrealized_pnl)}</div><div className="l">No realizado (posiciones)</div></div>
              <div className="metric"><div className="v">{fmtPct(last.dd_pct, 1)}</div><div className="l">Drawdown</div></div>
              <div className="metric"><div className="v">${fmtUsd(last.exposure_notional, 0)}</div><div className="l">Exposición</div></div>
              <div className="metric"><div className="v">${fmtUsd(last.margin_used, 0)}</div><div className="l">Margen usado</div></div>
              <div className="metric"><div className="v">{last.n_trades ?? 0}</div><div className="l">Trades</div></div>
            </div>
            {income && (
              <div className="metric-row">
                <div className="metric"><div className={`v ${pnlClass(income.mercado)}`}>{fmtUsd(income.mercado)}</div><div className="l">Mercado (cierres del bot)</div></div>
                <div className="metric"><div className={`v ${pnlClass(income.comisiones)}`}>{fmtUsd(income.comisiones)}</div><div className="l">Comisiones</div></div>
                <div className="metric"><div className={`v ${pnlClass(income.funding)}`}>{fmtUsd(income.funding)}</div><div className="l">Funding</div></div>
                {income.heredado !== 0 && (
                  <div className="metric"><div className="v muted">{fmtUsd(income.heredado)}</div><div className="l">Posiciones previas al bot (excluido)</div></div>
                )}
                {cuentaAbs != null && (
                  <div className="metric"><div className={`v ${pnlClass(cuentaAbs)}`}>{fmtUsd(cuentaAbs)}</div><div className="l">PnL cuenta completa (equity − inicial)</div></div>
                )}
              </div>
            )}
            <p className="note">Cifras de esta pestaña y de "Posiciones": última vela ({fmtDate(last.ts)}).
              <b>"PnL total (bot)" mide solo lo que el bot operó desde su inicio</b>: mercado (cierres de posiciones que el bot abrió)
              + comisiones + funding + no realizado. Los cierres de posiciones que ya existían en la cuenta antes de activar el bot
              se muestran aparte como "Posiciones previas al bot" y NO se cuentan. "PnL cuenta completa" = equity − capital inicial
              (ahí sí entra todo, incluido lo heredado{income && income.transfers !== 0 ? " y depósitos/retiros" : ""}).
              {income?.hasta ? ` Ledger sincronizado hasta ${fmtDate(income.hasta)}; los fills posteriores aparecen al correr el sync.` : ""}</p>
            <div className="card">
              <h2>Estrategia vs cuenta del cliente (YTD, en %)</h2>
              <PerfChart series={series} markerX={entryTs} markerLabel="Entrada" />
              <p className="note">Verde: la estrategia KV-9014 con el perfil del cliente, del 1 de enero a hoy.
                Azul: la cuenta real del cliente, anclada al nivel de la estrategia en su fecha de entrada. Este gráfico conserva todo el histórico (no se fija a la última vela).</p>
            </div>
          </>
        )
      )}

      {tab === "posiciones" && (() => {
        const openSyms = new Set(positions.map((p) => p.symbol));
        const pending = signals.filter((s) => !openSyms.has(s.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
        return (
          <>
            <div className="card">
              <h2>Corriendo ({positions.length}){last && ` · vela ${fmtDate(last.ts)}`}</h2>
              {positions.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin posiciones abiertas</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr><th>Activo</th><th>Lado</th><th>Monto $</th><th>Entrada</th><th>Precio</th><th>uPnL</th><th>%</th>
                      <th>Stop dinámico</th><th>Salida canal</th><th>Sale en</th><th>Dist.</th><th>Asegura</th></tr></thead>
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
                                <td>{fmtUsd(lv.slTrail)}</td>
                                <td>{fmtUsd(lv.slChan)}</td>
                                <td><b>{fmtUsd(lv.slEff)}</b></td>
                                <td className="muted">{lv.distPct.toFixed(1)}%</td>
                                <td className={pnlClass(lv.lockedPct)}>{lv.lockedPct >= 0 ? `+${lv.lockedPct.toFixed(1)}%` : `${lv.lockedPct.toFixed(1)}%`}</td>
                              </>
                            ) : (
                              <td colSpan={5} className="muted">calculando…</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note">La posición cierra en el nivel "Sale en" (el primero que se toque entre el <b>stop dinámico</b>, que
                sube/baja con el precio, y la <b>salida de canal</b>). "Asegura" = resultado que ya protege ese nivel frente a la entrada:
                positivo (verde) = toma de ganancia asegurada aunque el precio se dé la vuelta; negativo = pérdida máxima restante.
                Niveles calculados en vivo con velas de Binance y los parámetros del motor.</p>
            </div>

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
              <p className="note">Niveles de entrada de la estrategia con el perfil de este cliente ({client.risk_profiles?.name ?? "—"}).
                El punto indica dónde está el precio entre el disparo de venta (rojo) y el de compra (verde).
                {signals[0] && <> Señales actualizadas: {fmtDate(signals[0].created_at ?? signals[0].bar_time)}.</>}</p>
            </div>
          </>
        );
      })()}

      {tab === "historial" && (
        <>
          <div className="tabs">
            <div className={`tab ${histTab === "trades" ? "active" : ""}`} onClick={() => setHistTab("trades")}>Trades</div>
            <div className={`tab ${histTab === "orders" ? "active" : ""}`} onClick={() => setHistTab("orders")}>Órdenes</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <select value={fSymbol} onChange={(e) => setFSymbol(e.target.value)}>
              <option value="all">Todos los activos</option>
              {symbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}
            </select>
            <select value={fSide} onChange={(e) => setFSide(e.target.value)}>
              <option value="all">Compras y ventas</option>
              <option value="BUY">Compras (BUY)</option>
              <option value="SELL">Ventas (SELL)</option>
            </select>
            <button className="btn-mini" onClick={exportCsv} title="Descargar CSV">⬇ CSV</button>
          </div>

          {histTab === "trades" && (
            <div className="card">
              <h2>Trades ejecutados</h2>
              {ftrades.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin operaciones con esos filtros</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr><th>Fecha</th><th>Activo</th><th>Op.</th><th>Profit</th><th>Acum.</th></tr></thead>
                    <tbody>
                      {ftrades.map((t) => (
                        <tr key={t.id}>
                          <td>{fmtDate(t.ts)}</td>
                          <td>{t.symbol ? <AssetName symbol={t.symbol} /> : "—"}</td>
                          <td>{t.side}</td>
                          <td className={pnlClass(t.profit)}>{fmtUsd(t.profit)}</td>
                          <td className={pnlClass(t.cum)}>{fmtUsd(t.cum)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {histTab === "orders" && (
            <div className="card">
              <h2>Órdenes enviadas</h2>
              {forders.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin órdenes con esos filtros</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th><th>Qty</th><th>Estado</th><th style={{ textAlign: "left" }}>Error</th></tr></thead>
                    <tbody>
                      {forders.map((o) => (
                        <tr key={o.id}>
                          <td>{fmtDate(o.ts)}</td>
                          <td><AssetName symbol={o.symbol} /></td>
                          <td className={o.side === "BUY" ? "pos" : "neg"}>{o.side}{o.reduce_only ? " (cierre)" : ""}</td>
                          <td>{o.qty}</td>
                          <td className={o.status === "filled" ? "pos" : o.status === "error" ? "neg" : "muted"}>{o.status}</td>
                          <td className="muted" style={{ textAlign: "left" }}>{o.error ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "eventos" && (
        <div className="card">
          <h2>Eventos ({events.length})</h2>
          {events.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin eventos</div> : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Fecha</th><th>Evento</th><th style={{ textAlign: "left" }}>Detalle</th></tr></thead>
                <tbody>
                  {events.map((e) => {
                    const det = e.detail?.error ?? e.detail?.message ?? e.detail?.warning ??
                      (e.detail?.symbol ? `${e.detail.symbol}${e.detail.side ? " " + e.detail.side : ""}` : JSON.stringify(e.detail ?? {}));
                    return (
                      <tr key={e.id}>
                        <td>{fmtDate(e.ts)}</td>
                        <td className={e.level === "error" ? "neg" : e.level === "warn" ? "" : "muted"}>{e.kind}</td>
                        <td className="muted" style={{ textAlign: "left" }}>{String(det).slice(0, 200)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "cortes" && (
        <div className="card">
          <h2>Cortes mensuales</h2>
          {reports.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Aún no hay cortes generados</div> : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Mes</th><th>Equity inicial</th><th>Equity final</th><th>PnL $</th><th>PnL %</th><th>Realizado</th><th>Trades</th><th>Máx. DD</th></tr></thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.period_start}>
                      <td>{new Date(r.period_start + "T00:00:00Z").toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</td>
                      <td>${fmtUsd(r.start_equity, 0)}</td>
                      <td>${fmtUsd(r.end_equity, 0)}</td>
                      <td className={pnlClass(r.pnl_abs)}>{fmtUsd(r.pnl_abs)}</td>
                      <td className={pnlClass(r.pnl_pct)}>{fmtPct(r.pnl_pct)}</td>
                      <td className={pnlClass(r.realized)}>{fmtUsd(r.realized)}</td>
                      <td>{r.n_trades}</td>
                      <td className="neg">{fmtPct(r.max_dd_pct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
