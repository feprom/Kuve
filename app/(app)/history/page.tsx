"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtDate, pnlClass } from "@/lib/format";
import AssetName from "@/components/AssetName";
import EventFeed from "@/components/EventFeed";
import { attributeIncome } from "@/lib/pnl";
import { variantOf, comisionesPorMes, COMMISSION_BACKFILL_OK } from "@/lib/metrics";
import { fetchAll, fetchTrades, fetchIncome, fetchEvents } from "@/lib/queries";
import type { EventRow } from "@/lib/events";

type Trade = { id: number; ts: string; symbol: string; side: string; tag: string; profit: number; commission: number; qty: number | null; price: number | null };
type Order = { id: number; ts: string; symbol: string; side: string; qty: number; status: string; reduce_only: boolean; error: string | null };
type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string };

export default function History() {
  const [tab, setTab] = useState<"trades" | "orders" | "costos" | "eventos">("trades");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [costos, setCostos] = useState<{ comMes: Map<string, number>; funMes: Map<string, number> }>({ comMes: new Map(), funMes: new Map() });
  const [signals, setSignals] = useState<Signal[]>([]);
  const [eventos, setEventos] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [fSymbol, setFSymbol] = useState<string>("all");
  const [fSide, setFSide] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const { data: c, error: ce } = await sb.from("clients").select("id, risk_profiles(atr_mult)")
          .eq("auth_uid", user.id).maybeSingle();
        if (ce) throw new Error(ce.message);
        if (c) {
          const variant = variantOf((c as any).risk_profiles?.atr_mult);
          // costos SOLO del bot: desde su puesta en marcha (primer snapshot)
          const { data: firstSnap } = await sb.from("account_snapshots").select("ts")
            .eq("client_id", c.id).order("ts", { ascending: true }).limit(1);
          const botStart = firstSnap?.[0]?.ts ?? "1970-01-01";
          const [t, o, s, inc, ev] = await Promise.all([
            fetchTrades(sb, c.id),
            fetchAll<Order>((from, to) =>
              sb.from("orders").select("id, ts, symbol, side, qty, status, reduce_only, error")
                .eq("client_id", c.id).order("ts", { ascending: false }).range(from, to) as any, 3),
            sb.from("strategy_signals").select("*").eq("variant", variant)
              .order("bar_time", { ascending: false }).limit(40),
            fetchIncome(sb, c.id, botStart),
            fetchEvents(sb, c.id, 150),
          ]);
          if (!alive) return;
          const trs = t as unknown as Trade[];
          const ords = o as Order[];
          setTrades(trs); setOrders(ords);
          setSignals((s.data ?? []) as Signal[]);
          setEventos(((ev as any).data ?? []) as EventRow[]);
          // atribución de costos: LA MISMA función que el dashboard (lib/pnl.ts),
          // nada reimplementado — así "Costos" y el desglose del dashboard cuadran.
          const attrib = attributeIncome(
            inc as any[], trs, ords.filter((x) => x.status === "filled"),
          );
          // comisiones con fuente conmutada: trades antes del 13-jul-2026 (el
          // backfill del ledger tiene huecos), ledger después
          const comMes = comisionesPorMes(trs, attrib?.comisionFills ?? []);
          const funMes = new Map<string, number>();
          for (const f of attrib?.fundingFills ?? []) {
            const m = f.ts.slice(0, 7);
            funMes.set(m, (funMes.get(m) ?? 0) + f.usd);
          }
          setCostos({ comMes, funMes });
        }
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return (
    <>
      <div className="skel" style={{ height: 96, marginBottom: 10 }} />
      <div className="skel" style={{ height: 240, marginBottom: 14 }} />
      <div className="skel" style={{ height: 160 }} />
    </>
  );
  if (err) return (
    <div className="card"><h2>No se pudo cargar el historial</h2>
      <p className="note">Error: {err}. Reintentá recargando la página.</p></div>
  );

  const symbols = Array.from(new Set([...trades.map((t) => t.symbol), ...orders.map((o) => o.symbol)]
    .filter(Boolean))).sort();
  // último precio por símbolo (primera fila = barra más reciente por símbolo)
  const lastPrice: Record<string, number> = {};
  for (const s of signals) if (lastPrice[s.symbol] == null) lastPrice[s.symbol] = s.price;
  const ftrades = trades.filter((t) =>
    (fSymbol === "all" || t.symbol === fSymbol) && (fSide === "all" || t.side === fSide));
  const forders = orders.filter((o) =>
    (fSymbol === "all" || o.symbol === fSymbol) && (fSide === "all" || o.side === fSide));

  // Costos por mes UTC (comisiones con fuente conmutada + funding del ledger)
  const mesesSet = new Set<string>([...costos.comMes.keys(), ...costos.funMes.keys()]);
  const costosMes = Array.from(mesesSet).sort((a, b) => b.localeCompare(a))
    .map((m) => [m, { comisiones: costos.comMes.get(m) ?? 0, funding: costos.funMes.get(m) ?? 0 }] as const);
  const totCom = costosMes.reduce((a, [, v]) => a + v.comisiones, 0);
  const totFun = costosMes.reduce((a, [, v]) => a + v.funding, 0);

  function exportCsv() {
    const rows: string[][] = tab === "trades"
      ? [["fecha", "activo", "operacion", "cantidad", "precio", "profit", "comision"],
         ...ftrades.map((t) => [t.ts, t.symbol ?? "", t.side ?? "", String(t.qty ?? ""),
           String(t.price ?? ""), String(t.profit ?? ""), String(t.commission ?? "")])]
      : tab === "costos"
      ? [["mes", "comisiones", "funding", "total"],
         ...costosMes.map(([m, v]) => [m, v.comisiones.toFixed(4), v.funding.toFixed(4),
           (v.comisiones + v.funding).toFixed(4)])]
      : [["fecha", "activo", "lado", "cantidad", "reduce_only", "estado", "error"],
         ...forders.map((o) => [o.ts, o.symbol, o.side, String(o.qty),
           String(o.reduce_only), o.status, o.error ?? ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `kuve_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  return (
    <>
      <div className="pagetitle">Historial</div>
      <div className="tabs" role="tablist" aria-label="Secciones del historial">
        {([["trades", "Trades"], ["orders", "Órdenes"], ["costos", "Costos"], ["eventos", "Eventos"]] as const).map(([k, lbl]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab !== "eventos" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <select value={fSymbol} onChange={(e) => setFSymbol(e.target.value)} aria-label="Filtrar por activo">
            <option value="all">Todos los activos</option>
            {symbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}
          </select>
          <select value={fSide} onChange={(e) => setFSide(e.target.value)} aria-label="Filtrar por lado">
            <option value="all">Compras y ventas</option>
            <option value="BUY">Compras (BUY)</option>
            <option value="SELL">Ventas (SELL)</option>
          </select>
          <button className="btn-mini" onClick={exportCsv} title="Descargar CSV">⬇ CSV</button>
        </div>
      )}

      {tab === "trades" && (
        <div className="card">
          <h2>Trades ejecutados</h2>
          {ftrades.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin operaciones con esos filtros</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Activo</th><th>Op.</th><th>Profit</th><th>Comisión</th></tr></thead>
                <tbody>
                  {ftrades.slice(0, 300).map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.ts)}</td>
                      <td>{t.symbol ? <AssetName symbol={t.symbol} price={lastPrice[t.symbol] ?? t.price ?? undefined} /> : "—"}</td>
                      <td>{t.side}</td>
                      <td className={pnlClass(t.profit)}>{fmtUsd(t.profit)}</td>
                      <td className={t.commission ? "neg" : "muted"}>{t.commission ? fmtUsd(t.commission) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ftrades.length > 300 && <p className="note">Se muestran los últimos 300; el CSV exporta todos ({ftrades.length}).</p>}
        </div>
      )}

      {tab === "costos" && (
        <div className="card">
          <h2>Costos de operación (comisiones y funding)</h2>
          {costosMes.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin costos registrados aún</div> : (
            <>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Mes (UTC)</th><th>Comisiones</th><th>Funding</th><th>Total</th></tr></thead>
                  <tbody>
                    {costosMes.map(([m, v]) => (
                      <tr key={m}>
                        <td>{m}</td>
                        <td className={pnlClass(v.comisiones)}>{fmtUsd(v.comisiones)}</td>
                        <td className={pnlClass(v.funding)}>{fmtUsd(v.funding)}</td>
                        <td className={pnlClass(v.comisiones + v.funding)}><b>{fmtUsd(v.comisiones + v.funding)}</b></td>
                      </tr>
                    ))}
                    <tr>
                      <td><b>Total</b></td>
                      <td className={pnlClass(totCom)}><b>{fmtUsd(totCom)}</b></td>
                      <td className={pnlClass(totFun)}><b>{fmtUsd(totFun)}</b></td>
                      <td className={pnlClass(totCom + totFun)}><b>{fmtUsd(totCom + totFun)}</b></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="note">Misma atribución que el dashboard: comisiones y funding de la operativa del bot.
                Comisiones anteriores al {new Date(COMMISSION_BACKFILL_OK).toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })} salen del registro de trades
                (el ledger de Binance tiene el backfill incompleto en ese tramo); desde entonces, del ledger.
                Funding = pagos/cobros periódicos de futuros perpetuos (positivo = cobrado a tu favor). Meses en UTC.</p>
            </>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="card">
          <h2>Órdenes enviadas</h2>
          {forders.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin órdenes con esos filtros</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th><th>Qty</th><th>Estado</th></tr></thead>
                <tbody>
                  {forders.slice(0, 300).map((o) => (
                    <tr key={o.id} title={o.error ?? undefined}>
                      <td>{fmtDate(o.ts)}</td>
                      <td><AssetName symbol={o.symbol} price={lastPrice[o.symbol]} /></td>
                      <td className={o.side === "BUY" ? "pos" : "neg"}>{o.side}{o.reduce_only ? " (cierre)" : ""}</td>
                      <td>{o.qty}</td>
                      <td className={o.status === "filled" ? "pos" : o.status === "error" ? "neg" : "muted"}>{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "eventos" && (
        <EventFeed eventos={eventos} max={100} titulo="Eventos de la cuenta" />
      )}
    </>
  );
}
