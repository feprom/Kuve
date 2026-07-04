"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtDate, pnlClass } from "@/lib/format";
import AssetName from "@/components/AssetName";

type Trade = { id: number; ts: string; symbol: string; side: string; tag: string; profit: number; commission: number; cum: number; qty: number | null; price: number | null };
type Order = { id: number; ts: string; symbol: string; side: string; qty: number; status: string; reduce_only: boolean; error: string | null };
type Signal = { symbol: string; side: number; price: number; long_trigger: number; short_trigger: number; bar_time: string };

export default function History() {
  const [tab, setTab] = useState<"trades" | "orders">("trades");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [fSymbol, setFSymbol] = useState<string>("all");
  const [fSide, setFSide] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients").select("id, risk_profiles(atr_mult)")
        .eq("auth_uid", user.id).single();
      if (c) {
        const atr = (c as any).risk_profiles?.atr_mult;
        const variant = atr == null ? "default"
          : `atr${Number.isInteger(Number(atr)) ? parseInt(String(atr)) : atr}`;
        const [t, o, s] = await Promise.all([
          sb.from("trades").select("*").eq("client_id", c.id).order("ts", { ascending: false }).limit(100),
          sb.from("orders").select("*").eq("client_id", c.id).order("ts", { ascending: false }).limit(100),
          sb.from("strategy_signals").select("*").eq("variant", variant)
            .order("bar_time", { ascending: false }).limit(8),
        ]);
        setTrades(t.data ?? []); setOrders(o.data ?? []); setSignals(s.data ?? []);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;
  const sideName = (s: number) => (s === 1 ? "LARGO" : s === -1 ? "CORTO" : "PLANO");

  const symbols = Array.from(new Set([...trades.map((t) => t.symbol), ...orders.map((o) => o.symbol)]
    .filter(Boolean))).sort();
  const lastPrice: Record<string, number> = Object.fromEntries(
    signals.map((s) => [s.symbol, s.price]));
  const ftrades = trades.filter((t) =>
    (fSymbol === "all" || t.symbol === fSymbol) && (fSide === "all" || t.side === fSide));
  const forders = orders.filter((o) =>
    (fSymbol === "all" || o.symbol === fSymbol) && (fSide === "all" || o.side === fSide));

  function exportCsv() {
    const rows: string[][] = tab === "trades"
      ? [["fecha", "activo", "operacion", "cantidad", "precio", "profit", "comision", "acumulado"],
         ...ftrades.map((t) => [t.ts, t.symbol ?? "", t.side ?? "", String(t.qty ?? ""),
           String(t.price ?? ""), String(t.profit ?? ""), String(t.commission ?? ""), String(t.cum ?? "")])]
      : [["fecha", "activo", "lado", "cantidad", "reduce_only", "estado", "error"],
         ...forders.map((o) => [o.ts, o.symbol, o.side, String(o.qty),
           String(o.reduce_only), o.status, o.error ?? ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `kuve_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="pagetitle">Historial</div>
      <div className="tabs">
        <div className={`tab ${tab === "trades" ? "active" : ""}`} onClick={() => setTab("trades")}>Trades</div>
        <div className={`tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>Órdenes</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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

      {tab === "trades" && (
        <div className="card">
          <h2>Trades ejecutados</h2>
          {ftrades.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin operaciones con esos filtros</div> : (
            <table>
              <thead><tr><th>Fecha</th><th>Activo</th><th>Op.</th><th>Profit</th><th>Acum.</th></tr></thead>
              <tbody>
                {ftrades.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.ts)}</td>
                    <td>{t.symbol ? <AssetName symbol={t.symbol} price={lastPrice[t.symbol]} /> : "—"}</td>
                    <td>{t.side}</td>
                    <td className={pnlClass(t.profit)}>{fmtUsd(t.profit)}</td>
                    <td className={pnlClass(t.cum)}>{fmtUsd(t.cum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="card">
          <h2>Órdenes enviadas</h2>
          {forders.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin órdenes con esos filtros</div> : (
            <table>
              <thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th><th>Qty</th><th>Estado</th></tr></thead>
              <tbody>
                {forders.map((o) => (
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
          )}
        </div>
      )}

    </>
  );
}
