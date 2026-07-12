"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import Sparkline from "@/components/Sparkline";
import { attributeIncome, Attribution, IncomeRow, BotTradeLike } from "@/lib/pnl";

type Run = { id: number; bar_time: string; started_at: string; finished_at: string | null; n_clients: number; n_ok: number; n_failed: number };
type Cli = { id: string; name: string; email: string | null; mode: string; enabled: boolean; activation_requested: boolean; key_status: string; created_at: string; risk_profile_id: number | null; risk_profiles: { name: string } | null };
type Snap = { client_id: string; ts: string; equity: number; start_equity: number; realized_cum: number; exposure_notional: number; open_positions: number; dd_pct: number; unrealized_pnl: number };
type Evt = { id: number; ts: string; client_id: string | null; kind: string; level: string; detail: any };

/** First day of next month, 00:00 UTC. */
function nextCutoff(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
}

export default function Admin() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [clients, setClients] = useState<Cli[]>([]);
  const [histByClient, setHistByClient] = useState<Map<string, Snap[]>>(new Map());
  const [attribByClient, setAttribByClient] = useState<Map<string, Attribution | null>>(new Map());
  const [events, setEvents] = useState<Evt[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleClient(id: string, enabled: boolean) {
    if (enabled && !confirm("¿Activar el bot para este cliente? Empezará a operar en la próxima vela.")) return;
    if (!enabled && !confirm("¿Pausar este cliente? Sus posiciones se gestionarán según su modo de desactivación.")) return;
    setBusyId(id);
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("admin_toggle_client", { p_client_id: id, p_enabled: enabled });
    if (error) alert(error.message);
    location.reload();
  }

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: adm } = await sb.from("admin_users").select("auth_uid").eq("auth_uid", user.id);
      if (!adm?.length) { setIsAdmin(false); return; }
      setIsAdmin(true);
      const [r, c, s, e, inc, tr] = await Promise.all([
        sb.from("bot_runs").select("*").order("id", { ascending: false }).limit(12),
        sb.from("clients").select("*, risk_profiles(name)").order("created_at"),
        sb.from("account_snapshots")
          .select("client_id, ts, equity, start_equity, realized_cum, exposure_notional, open_positions, dd_pct, unrealized_pnl")
          .order("ts", { ascending: true }).limit(6000),
        sb.from("events").select("*").order("ts", { ascending: false }).limit(30),
        sb.from("account_income").select("client_id, income_type, income, ts, symbol").limit(10000),
        sb.from("trades").select("client_id, symbol, ts, profit").limit(2000),
      ]);
      setRuns(r.data ?? []);
      setClients(c.data ?? []);
      const byClient = new Map<string, Snap[]>();
      for (const row of (s.data ?? []) as Snap[]) {
        const arr = byClient.get(row.client_id) ?? [];
        arr.push(row);
        byClient.set(row.client_id, arr);
      }
      setHistByClient(byClient);
      // Atribucion del PnL al bot por cliente (lib/pnl.ts): ledger desde el
      // primer snapshot de cada cliente + sus trades registrados por el bot.
      const attrib = new Map<string, Attribution | null>();
      const incRows = ((inc as any).data ?? []) as (IncomeRow & { client_id: string })[];
      const trRows = ((tr as any).data ?? []) as (BotTradeLike & { client_id: string })[];
      for (const [cid, arr] of Array.from(byClient.entries())) {
        const t0 = arr[0] ? new Date(arr[0].ts).getTime() : 0;
        attrib.set(cid, attributeIncome(
          incRows.filter((x) => x.client_id === cid && new Date(x.ts).getTime() >= t0),
          trRows.filter((x) => x.client_id === cid),
        ));
      }
      setAttribByClient(attrib);
      setEvents(e.data ?? []);
    })();
  }, []);

  if (isAdmin === null) return <div className="muted">Cargando…</div>;
  if (!isAdmin) return <div className="card"><p className="note">No tienes permisos de administrador.</p></div>;

  const lastRun = runs[0];
  const ageMin = lastRun ? (Date.now() - new Date(lastRun.started_at).getTime()) / 60000 : Infinity;
  const health: { label: string; cls: string } =
    ageMin <= 75 ? (lastRun && lastRun.n_failed > 0
      ? { label: `OPERANDO · ${lastRun.n_failed} cliente(s) con fallo`, cls: "off" }
      : { label: "OPERANDO", cls: "on" })
      : { label: `SIN REPORTAR ${Math.round(ageMin)} min`, cls: "off" };

  const latestOf = (id: string) => {
    const arr = histByClient.get(id);
    return arr && arr.length ? arr[arr.length - 1] : undefined;
  };
  const sparkOf = (id: string) => {
    const arr = histByClient.get(id) ?? [];
    const cutoff = Date.now() - 7 * 86400_000;
    const recent = arr.filter((s) => new Date(s.ts).getTime() >= cutoff);
    const pts = (recent.length >= 2 ? recent : arr.slice(-30))
      .map((s) => ({ x: new Date(s.ts).getTime(), y: s.equity }));
    return pts;
  };

  // PnL atribuido al BOT: realizado neto (ledger) + no realizado; si el ledger
  // de un cliente aun no sincroniza, cae a equity - capital inicial.
  const pnlBotOf = (id: string): number | null => {
    const s = latestOf(id);
    if (!s) return null;
    const a = attribByClient.get(id);
    if (a) return a.realizadoNeto + (s.unrealized_pnl ?? 0);
    return s.start_equity ? s.equity - s.start_equity : null;
  };

  const active = clients.filter((c) => c.enabled);
  const aum = active.reduce((a, c) => a + (latestOf(c.id)?.equity ?? 0), 0);
  const pnlTotal = active.reduce((a, c) => a + (pnlBotOf(c.id) ?? 0), 0);
  const exposure = active.reduce((a, c) => a + (latestOf(c.id)?.exposure_notional ?? 0), 0);
  const cutoff = nextCutoff();

  return (
    <>
      <div className="pagetitle">Administración
        <span className={`badge ${health.cls}`}>{health.label}</span>
      </div>

      <div className="metric-row">
        <div className="metric"><div className="v">${fmtUsd(aum, 0)}</div><div className="l">Capital gestionado (AUM)</div></div>
        <div className="metric"><div className={`v ${pnlClass(pnlTotal)}`}>{fmtUsd(pnlTotal, 0)}</div><div className="l">PnL del bot (clientes activos)</div></div>
        <div className="metric"><div className="v">{active.length}/{clients.length}</div><div className="l">Clientes activos</div></div>
        <div className="metric"><div className="v">${fmtUsd(exposure, 0)}</div><div className="l">Exposición total</div></div>
      </div>

      <div className="admin-grid">
        {clients.map((c) => {
          const s = latestOf(c.id);
          const pnl = pnlBotOf(c.id);
          const pnlPct = s && s.start_equity && pnl != null ? (pnl / s.start_equity) * 100 : null;
          const a = attribByClient.get(c.id);
          const realizado = a ? a.realizadoNeto : (s?.realized_cum ?? null);
          const spark = sparkOf(c.id);
          const sparkColor = pnl == null ? "var(--accent)" : pnl >= 0 ? "var(--green)" : "var(--red)";
          return (
            <Link key={c.id} href={`/admin/${c.id}`} className="client-card">
              <div className="cc-head">
                <div className="cc-name">{c.name || c.id.slice(0, 8)}</div>
                <div className="cc-badges">
                  <span className={`badge ${c.enabled ? "on" : "off"}`}>{c.enabled ? "ON" : "OFF"}</span>
                  {c.activation_requested && !c.enabled && <span className="badge on">SOLICITA ALTA</span>}
                  {c.key_status !== "valid" && <span className="badge neutral">sin claves</span>}
                  {c.mode === "testnet" && <span className="badge neutral">testnet</span>}
                </div>
              </div>

              <div>
                <div className="cc-equity">{s ? `$${fmtUsd(s.equity, 0)}` : "—"}</div>
                <div className={`cc-pnl ${pnlClass(pnl)}`}>
                  {pnl == null ? "Sin datos" : `${fmtUsd(pnl, 0)} (${fmtPct(pnlPct, 1)}) · PnL bot`}
                </div>
              </div>

              <Sparkline points={spark} color={sparkColor} />

              <div className="mini-metrics">
                <div className="mm"><div className={`v ${pnlClass(realizado)}`}>{realizado == null ? "—" : `$${fmtUsd(realizado, 0)}`}</div><div className="l">Realizado</div></div>
                <div className="mm"><div className="v">${fmtUsd(s?.exposure_notional ?? null, 0)}</div><div className="l">Exposición</div></div>
                <div className="mm"><div className="v">{s?.open_positions ?? "—"}</div><div className="l">Posiciones</div></div>
                <div className="mm"><div className={`v ${s ? pnlClass(-Math.abs(s.dd_pct)) : ""}`}>{s ? fmtPct(s.dd_pct, 1) : "—"}</div><div className="l">Drawdown</div></div>
                <div className="mm"><div className="v">{c.risk_profiles?.name?.split(" ")[0] ?? "—"}</div><div className="l">Perfil</div></div>
              </div>

              <div onClick={(e) => e.preventDefault()}>
                {c.enabled ? (
                  <button className="btn-mini pause" disabled={busyId === c.id}
                    onClick={() => toggleClient(c.id, false)}>⏸ Pausar</button>
                ) : (
                  <button className="btn-mini play"
                    disabled={busyId === c.id || c.key_status !== "valid" || !c.risk_profile_id}
                    title={c.key_status !== "valid" ? "Sin claves válidas" : !c.risk_profile_id ? "Sin perfil de riesgo" : "Activar"}
                    onClick={() => toggleClient(c.id, true)}>▶ Activar</button>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <details className="card">
        <summary>Estado del bot (últimas barras)</summary>
        {runs.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin ejecuciones registradas</div> : (
          <table>
            <thead><tr><th>Vela</th><th>Inicio</th><th>Clientes</th><th>OK</th><th>Fallos</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.bar_time)}</td>
                  <td>{fmtDate(r.started_at)}</td>
                  <td>{r.n_clients}</td>
                  <td className="pos">{r.n_ok ?? "—"}</td>
                  <td className={r.n_failed ? "neg" : "muted"}>{r.n_failed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="note">Watchdog: cada 10 min Supabase comprueba la última ejecución; si supera el umbral (90 min) envía alerta por Telegram y registra el evento. Próximo corte mensual: {cutoff.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })} 00:00 UTC.</p>
      </details>

      <details className="card" open>
        <summary>Eventos recientes</summary>
        {events.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin eventos</div> : (
          <table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Evento</th><th style={{ textAlign: "left" }}>Detalle</th></tr></thead>
            <tbody>
              {events.map((e) => {
                const cli = clients.find((c) => c.id === e.client_id);
                const det = e.detail?.error ?? e.detail?.message ?? e.detail?.warning ??
                  (e.detail?.symbol ? `${e.detail.symbol}${e.detail.side ? " " + e.detail.side : ""}` : "");
                return (
                  <tr key={e.id} title={JSON.stringify(e.detail ?? {})}>
                    <td>{fmtDate(e.ts)}</td>
                    <td>{cli?.name?.trim() || (e.client_id ? e.client_id.slice(0, 8) : "sistema")}</td>
                    <td className={e.level === "error" ? "neg" : e.level === "warn" ? "" : "muted"}>{e.kind}</td>
                    <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      className="muted">{String(det).slice(0, 120)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </details>
    </>
  );
}
