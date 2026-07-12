"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import AssetName from "@/components/AssetName";
import AccountView from "@/components/AccountView";

/**
 * Detalle de un cliente para el ADMIN: cabecera con controles (perfil, pausar)
 * + la MISMA vista unificada del cliente (AccountView) + pestañas operativas
 * (historial, eventos, cortes). Entrar aquí = entrar a la cuenta del cliente.
 */
type Client = {
  id: string; name: string; email: string | null; mode: string; enabled: boolean;
  activation_requested: boolean; key_status: string; created_at: string;
  risk_profile_id: number | null;
  risk_profiles: { name: string; atr_mult: number | null } | null;
};
type Profile = { id: number; name: string };
type Trade = { id: number; ts: string; symbol: string; side: string; profit: number; commission: number; cum: number; qty: number | null; price: number | null };
type Order = { id: number; ts: string; symbol: string; side: string; qty: number; status: string; reduce_only: boolean; error: string | null };
type Evt = { id: number; ts: string; kind: string; level: string; detail: any };
type Report = {
  period_start: string; period_end: string; start_equity: number; end_equity: number;
  pnl_abs: number; pnl_pct: number; realized: number; n_trades: number; max_dd_pct: number;
};

type Tab = "cuenta" | "historial" | "eventos" | "cortes";

/** First day of next month, 00:00 UTC. */
function nextCutoff(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
}

export default function AdminClientDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("cuenta");
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

    const [c, p, t, o, e, r] = await Promise.all([
      sb.from("clients").select("*, risk_profiles(name, atr_mult)").eq("id", id).single(),
      sb.from("risk_profiles").select("id, name").order("id"),
      sb.from("trades").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(300),
      sb.from("orders").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(300),
      sb.from("events").select("*").eq("client_id", id).order("ts", { ascending: false }).limit(150),
      sb.from("client_monthly_reports").select("*").eq("client_id", id).order("period_start", { ascending: false }),
    ]);
    setClient(c.data as any);
    setProfiles(p.data ?? []);
    setTrades(t.data ?? []);
    setOrders(o.data ?? []);
    setEvents(e.data ?? []);
    setReports(r.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

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
        <div className={`tab ${tab === "cuenta" ? "active" : ""}`} onClick={() => setTab("cuenta")}>Cuenta</div>
        <div className={`tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>Historial</div>
        <div className={`tab ${tab === "eventos" ? "active" : ""}`} onClick={() => setTab("eventos")}>Eventos</div>
        <div className={`tab ${tab === "cortes" ? "active" : ""}`} onClick={() => setTab("cortes")}>Cortes</div>
      </div>

      {/* La MISMA vista que ve el cliente en su dashboard, con sus datos. */}
      {tab === "cuenta" && <AccountView client={client} esAdmin />}

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
