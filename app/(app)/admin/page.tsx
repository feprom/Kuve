"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import Sparkline from "@/components/Sparkline";
import { attributeIncome, Attribution } from "@/lib/pnl";
import {
  detectarFlujos, curvaTwr, maxDrawdown, seriePnl, sanearSnaps, ultimoPorDia,
  factorVivo as factorVivoDe, Flujo,
} from "@/lib/metrics";
import { fetchSnaps, fetchIncome, fetchTrades, fetchOrdersFilled } from "@/lib/queries";
import { eventLabel } from "@/lib/events";

type Run = { id: number; bar_time: string; started_at: string; finished_at: string | null; n_clients: number; n_ok: number; n_failed: number };
type Cli = { id: string; name: string; email: string | null; mode: string; enabled: boolean; activation_requested: boolean; key_status: string; created_at: string; risk_profile_id: number | null; risk_profiles: { name: string } | null };
type Snap = { client_id: string; ts: string; equity: number; start_equity: number; realized_cum: number; exposure_notional: number; open_positions: number; dd_pct: number; unrealized_pnl: number };
type Movs = { flujos: Flujo[]; curva: { x: number; y: number }[]; serie: { x: number; pnl: number; base: number }[] };
type Pos = { id: number; client_id: string; bar_time: string; symbol: string; side: string; pos_amt: number; entry_price: number; price: number };
type Evt = { id: number; ts: string; client_id: string | null; kind: string; level: string; detail: any };

/** First day of next month, 00:00 UTC. */
function nextCutoff(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
}

export default function Admin() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [clients, setClients] = useState<Cli[]>([]);
  const [histByClient, setHistByClient] = useState<Map<string, Snap[]>>(new Map());
  const [attribByClient, setAttribByClient] = useState<Map<string, Attribution | null>>(new Map());
  const [movsByClient, setMovsByClient] = useState<Map<string, Movs>>(new Map());
  const [events, setEvents] = useState<Evt[]>([]);
  const [posByClient, setPosByClient] = useState<Map<string, Pos[]>>(new Map());
  const [livePx, setLivePx] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleClient(id: string, enabled: boolean) {
    if (enabled && !confirm("¿Activar el bot para este cliente? Empezará a operar en la próxima vela.")) return;
    if (!enabled && !confirm("¿Pausar este cliente? Sus posiciones se gestionarán según su modo de desactivación.")) return;
    setBusyId(id);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("admin_toggle_client", { p_client_id: id, p_enabled: enabled });
      if (error) { alert(error.message); return; }
      location.reload();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data: adm } = await sb.from("admin_users").select("auth_uid").eq("auth_uid", user.id);
      if (!adm?.length) { setIsAdmin(false); return; }
      setIsAdmin(true);
      const [r, c, e] = await Promise.all([
        sb.from("bot_runs").select("*").order("id", { ascending: false }).limit(12),
        sb.from("clients").select("*, risk_profiles(name)").order("created_at"),
        sb.from("events").select("*").order("ts", { ascending: false }).limit(30),
      ]);
      setRuns(r.data ?? []);
      const clis = (c.data ?? []) as Cli[];
      setClients(clis);
      setEvents(e.data ?? []);
      // Carga POR CLIENTE y paginada: el barrido global con .limit() repartía
      // las filas entre todos los clientes (≈25 días de historia con 10
      // clientes) y truncaba en silencio — la tarjeta divergía del detalle.
      const byClient = new Map<string, Snap[]>();
      const attrib = new Map<string, Attribution | null>();
      const movs = new Map<string, Movs>();
      await Promise.all(clis.map(async (cli) => {
        const arr = sanearSnaps((await fetchSnaps(sb, cli.id)) as unknown as Snap[])
          .map((x) => ({ ...x, client_id: cli.id }));
        if (!arr.length) return;
        byClient.set(cli.id, arr);
        const [suIncome, suTrades, suOrders] = await Promise.all([
          fetchIncome(sb, cli.id, arr[0].ts),
          fetchTrades(sb, cli.id, 2),
          fetchOrdersFilled(sb, cli.id, 2),
        ]);
        const a = attributeIncome(suIncome as any[], suTrades as any[], suOrders as any[]);
        attrib.set(cli.id, a);
        // Movimientos de capital y series time-weighted: las MISMAS funciones
        // que la vista de la cuenta (lib/metrics.ts) — tarjeta y detalle cuadran.
        const flujos = detectarFlujos(arr, suIncome as any[]);
        movs.set(cli.id, {
          flujos,
          curva: curvaTwr(arr, flujos, a?.heredadoFills ?? []),
          serie: seriePnl(arr, flujos, a?.heredadoFills ?? []),
        });
      }));
      setHistByClient(byClient);
      setAttribByClient(attrib);
      setMovsByClient(movs);
      const ps = await sb.from("positions").select("id, client_id, bar_time, symbol, side, pos_amt, entry_price, price")
        .gte("bar_time", new Date(Date.now() - 26 * 3600e3).toISOString())
        .order("bar_time", { ascending: true }).limit(4000);
      // posiciones abiertas de la ÚLTIMA vela de cada cliente
      const pb = new Map<string, Pos[]>();
      for (const row of ((ps as any).data ?? []) as Pos[]) {
        const arr = pb.get(row.client_id) ?? [];
        arr.push(row);
        pb.set(row.client_id, arr);
      }
      const pbLatest = new Map<string, Pos[]>();
      for (const [cid, arr] of Array.from(pb.entries())) {
        const lastBar = arr[arr.length - 1].bar_time;
        // deduplicar PRIMERO (fila más nueva por id gana, incluye cierres con
        // pos_amt=0) y filtrar ceros AL FINAL — si no, un cierre reciente
        // queda tapado por la fila vieja cuando el bot reprocesa la vela.
        const seen = new Map<string, Pos>();
        for (const p of arr) {
          if (p.bar_time !== lastBar) continue;
          const prev = seen.get(p.symbol);
          if (!prev || p.id > prev.id) seen.set(p.symbol, p);
        }
        pbLatest.set(cid, Array.from(seen.values()).filter((p) => p.pos_amt !== 0)
          .sort((a, b) => a.symbol.localeCompare(b.symbol)));
      }
      setPosByClient(pbLatest);
    })();
  }, []);

  // precios EN VIVO (ticker público de Binance, cada 15 s) para el estado de
  // las posiciones en las tarjetas
  useEffect(() => {
    const syms = Array.from(new Set(Array.from(posByClient.values()).flat().map((p) => p.symbol)));
    if (!syms.length) return;
    let alive = true;
    const wanted = new Set(syms);
    const load = async () => {
      // UNA sola llamada para todos los símbolos de todos los clientes: evita
      // N_clientes × M_símbolos peticiones cada 15 s (rate-limit de Binance)
      const out: Record<string, number> = {};
      try {
        const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/price");
        if (r.ok) {
          const j = (await r.json()) as { symbol: string; price: string }[];
          for (const x of j) if (wanted.has(x.symbol)) { const v = +x.price; if (v > 0) out[x.symbol] = v; }
        }
      } catch { /* sin red: se mantiene el precio de la vela */ }
      if (alive && Object.keys(out).length) setLivePx((prev) => ({ ...prev, ...out }));
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line
  }, [posByClient]);

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
  // Sparkline sobre la curva TIME-WEIGHTED, no sobre el equity crudo: un
  // depósito ya no se dibuja como un rally. Últimos 30 días, un punto por día.
  const sparkOf = (id: string) => {
    const curva = movsByClient.get(id)?.curva ?? [];
    const cutoff = Date.now() - 30 * 86400_000;
    const diario = ultimoPorDia(curva.map((p) => ({ ts: new Date(p.x).toISOString(), p })))
      .map((r) => r.p);
    const recent = diario.filter((p) => p.x >= cutoff);
    return (recent.length >= 2 ? recent : diario).map((p) => ({ x: p.x, y: (p.y - 1) * 100 }));
  };

  // Estado EN VIVO de las posiciones de un cliente (precios cada 15 s)
  const liveStatsOf = (id: string) => {
    const poss = posByClient.get(id) ?? [];
    if (!poss.length) return null;
    let upnl = 0, exp = 0;
    for (const p of poss) {
      const px = livePx[p.symbol] ?? p.price;
      exp += Math.abs(p.pos_amt * px);
      if (p.entry_price) upnl += p.pos_amt * (px - p.entry_price);
    }
    return { upnl, exp, n: poss.length };
  };

  /** Factor time-weighted con el tramo en vivo — vía lib/metrics (factorVivo),
   *  que además neutraliza un depósito ocurrido entre la última vela y ahora. */
  const factorOf = (id: string): number | null => {
    const arr = histByClient.get(id) ?? [];
    const m = movsByClient.get(id);
    if (!m || arr.length < 2) return null;
    const s = latestOf(id);
    const ls = liveStatsOf(id);
    const equityVivo = s && ls && s.unrealized_pnl != null ? s.equity + ls.upnl - s.unrealized_pnl : null;
    return factorVivoDe(arr, m.flujos, attribByClient.get(id)?.heredadoFills ?? [], equityVivo);
  };

  // Drawdown MÁXIMO — misma definición que la vista de la cuenta: la mayor
  // caída desde el pico de la curva time-weighted, incluyendo el punto en vivo.
  const ddMaxOf = (id: string): number | null => {
    const curva = movsByClient.get(id)?.curva ?? [];
    if (curva.length < 2) return null;
    const f = factorOf(id);
    return maxDrawdown([...curva.map((p) => p.y), ...(f != null ? [f] : [])]);
  };

  // PnL atribuido al BOT: el último punto de la MISMA seriePnl que usa la vista
  // de la cuenta, más el ajuste en vivo — nada reimplementado.
  const pnlBotOf = (id: string): number | null => {
    const serie = movsByClient.get(id)?.serie ?? [];
    const s = latestOf(id);
    if (!s || serie.length < 2) return null;
    let v = serie[serie.length - 1].pnl;
    const ls = liveStatsOf(id);
    if (ls && s.unrealized_pnl != null) v += ls.upnl - s.unrealized_pnl;
    return v;
  };

  /** Rendimiento time-weighted en % — el número que se muestra junto al PnL. */
  const pnlPctOf = (id: string): number | null => {
    const f = factorOf(id);
    return f == null ? null : (f - 1) * 100;
  };

  const active = clients.filter((c) => c.enabled);
  const aum = active.reduce((a, c) => {
    const s = latestOf(c.id); if (!s) return a;
    const ls = liveStatsOf(c.id);
    return a + s.equity + (ls && s.unrealized_pnl != null ? ls.upnl - s.unrealized_pnl : 0);
  }, 0);
  const pnlTotal = active.reduce((a, c) => a + (pnlBotOf(c.id) ?? 0), 0);
  const exposure = active.reduce((a, c) => a + (liveStatsOf(c.id)?.exp ?? latestOf(c.id)?.exposure_notional ?? 0), 0);
  const cutoff = nextCutoff();
  /** Horas desde el último snapshot del cliente (para marcar datos rancios). */
  const staleHoras = (id: string): number | null => {
    const s = latestOf(id);
    return s ? (Date.now() - new Date(s.ts).getTime()) / 3600e3 : null;
  };

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
          const pnlPct = pnlPctOf(c.id);
          const movs = movsByClient.get(c.id);
          const a = attribByClient.get(c.id);
          const realizado = a ? a.realizadoNeto : (s?.realized_cum ?? null);
          const spark = sparkOf(c.id);
          const sparkColor = pnl == null ? "var(--accent)" : pnl >= 0 ? "var(--green)" : "var(--red)";
          return (
            <div key={c.id} className="client-card" role="link" tabIndex={0}
              onClick={() => router.push(`/admin/${c.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/admin/${c.id}`); }}>
              <div className="cc-head">
                <div className="cc-name">{c.name || c.id.slice(0, 8)}</div>
                <div className="cc-badges">
                  <span className={`badge ${c.enabled ? "on" : "off"}`}>{c.enabled ? "ON" : "OFF"}</span>
                  {c.activation_requested && !c.enabled && <span className="badge on">SOLICITA ALTA</span>}
                  {c.key_status !== "valid" && <span className="badge neutral">sin claves</span>}
                  {c.mode === "testnet" && <span className="badge neutral">testnet</span>}
                  {(() => {
                    const h = staleHoras(c.id);
                    return h != null && h > 3
                      ? <span className="badge off" title="El bot no reporta snapshots de esta cuenta desde hace más de 3 horas: el equity y el AUM usan el último dato disponible">datos de hace {Math.round(h)} h</span>
                      : null;
                  })()}
                </div>
              </div>

              <div>
                <div className="cc-equity">{s ? `$${fmtUsd(s.equity, 0)}` : "—"}</div>
                <div className={`cc-pnl ${pnlClass(pnl)}`}
                  title="PnL del bot en USD y rendimiento time-weighted. Los depósitos y retiros no cuentan como resultado.">
                  {pnl == null ? "Sin datos" : `${fmtUsd(pnl, 0)} (${fmtPct(pnlPct, 1)}) · PnL bot`}
                </div>
                {!!movs?.flujos.length && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}
                    title={movs.flujos.map((f) => `${fmtDate(new Date(f.t).toISOString())}  ${f.usd >= 0 ? "+" : "−"}$${fmtUsd(Math.abs(f.usd))}  (${f.fuente})`).join("\n")}>
                    {movs.flujos.length} movimiento{movs.flujos.length === 1 ? "" : "s"} de capital · neto{" "}
                    {movs.flujos.reduce((a, f) => a + f.usd, 0) >= 0 ? "+" : "−"}$
                    {fmtUsd(Math.abs(movs.flujos.reduce((a, f) => a + f.usd, 0)), 0)}
                  </div>
                )}
              </div>

              <Sparkline points={spark} color={sparkColor} />

              {(() => {
                const poss = posByClient.get(c.id) ?? [];
                if (!poss.length) return null;
                // TOTAL en vivo de las posiciones abiertas: uPnL sumado
                const upnlTot = poss.reduce((a, p) => {
                  const px = livePx[p.symbol] ?? p.price;
                  return a + (p.entry_price ? p.pos_amt * (px - p.entry_price) : 0);
                }, 0);
                const entryNot = poss.reduce((a, p) => a + Math.abs(p.pos_amt * (p.entry_price || p.price)), 0);
                const upnlPct = entryNot ? (upnlTot / entryNot) * 100 : null;
                return (
                  <div title="PnL no realizado de las posiciones abiertas (suma), en USD y en % frente al monto de entrada, con precio en vivo (15 s)">
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      <span className="muted">PnL pos. (vivo): </span>
                      <b className={pnlClass(upnlTot)}>{upnlTot >= 0 ? "+$" : "−$"}{fmtUsd(Math.abs(upnlTot))}</b>
                      <b className={pnlClass(upnlPct)} style={{ marginLeft: 6 }}>({fmtPct(upnlPct, 2)})</b>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 12 }}>
                      {poss.map((p) => {
                        const px = livePx[p.symbol] ?? p.price;
                        const pct = p.entry_price ? (px / p.entry_price - 1) * 100 * Math.sign(p.pos_amt) : null;
                        return (
                          <span key={p.symbol} style={{ whiteSpace: "nowrap" }}>
                            <span className="muted">{p.symbol.replace("USDT", "")}</span>
                            <span className={p.pos_amt > 0 ? "pos" : "neg"}> {p.pos_amt > 0 ? "▲" : "▼"} </span>
                            <b className={pnlClass(pct)}>{fmtPct(pct, 1)}</b>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="mini-metrics">
                <div className="mm"><div className={`v ${pnlClass(realizado)}`}>{realizado == null ? "—" : `$${fmtUsd(realizado, 0)}`}</div><div className="l">Realizado</div></div>
                <div className="mm"><div className="v">${fmtUsd(liveStatsOf(c.id)?.exp ?? s?.exposure_notional ?? null, 0)}</div><div className="l">Exposición</div></div>
                <div className="mm"><div className="v">{liveStatsOf(c.id)?.n ?? s?.open_positions ?? "—"}</div><div className="l">Posiciones</div></div>
                <div className="mm" title="Drawdown máximo: la mayor caída desde el pico de la cuenta — mismo número que dentro de la cuenta">
                  <div className={`v ${pnlClass(ddMaxOf(c.id) ?? (s ? -Math.abs(s.dd_pct) : null))}`}>{ddMaxOf(c.id) != null ? fmtPct(ddMaxOf(c.id), 1) : s ? fmtPct(s.dd_pct, 1) : "—"}</div>
                  <div className="l">DD máx.</div>
                </div>
                <div className="mm"><div className="v">{c.risk_profiles?.name?.split(" ")[0] ?? "—"}</div><div className="l">Perfil</div></div>
              </div>

              <div onClick={(e) => e.stopPropagation()}>
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
            </div>
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
        <p className="note">Watchdog: cada 10 min Supabase comprueba la última ejecución; si supera el umbral (90 min) envía alerta por Telegram y registra el evento. Próximo corte mensual: {cutoff.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })} 00:00 UTC.</p>
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
                    <td className={e.level === "error" ? "neg" : e.level === "warn" ? "" : "muted"}>{eventLabel(e)}</td>
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
