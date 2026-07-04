"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, fmtDate, pnlClass } from "@/lib/format";
import Donut from "@/components/Donut";

type Snap = {
  equity: number; wallet_balance: number; unrealized_pnl: number;
  margin_used: number; exposure_notional: number; open_positions: number;
  realized_cum: number; dd_pct: number; start_equity: number; bar_time: string; ts: string;
};
type Pos = { id: number; symbol: string; side: string; pos_amt: number; price: number; entry_price: number; unrealized_pnl: number };

/** The bot may write more than one row per symbol for the same bar (e.g. after a
 *  restart) — keep only the most recent row per symbol. */
function dedupeBySymbol(rows: Pos[]): Pos[] {
  const seen = new Map<string, Pos>();
  for (const r of rows) {
    const prev = seen.get(r.symbol);
    if (!prev || r.id > prev.id) seen.set(r.symbol, r);
  }
  return Array.from(seen.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export default function Dashboard() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients").select("*").eq("auth_uid", user.id).single();
      setClient(c);
      if (c) {
        const { data: s } = await sb.from("account_snapshots").select("*")
          .eq("client_id", c.id).order("ts", { ascending: false }).limit(1);
        const latest = s?.[0] ?? null;
        setSnap(latest);
        if (latest) {
          const { data: p } = await sb.from("positions").select("*")
            .eq("client_id", c.id).eq("bar_time", latest.bar_time);
          setPositions(dedupeBySymbol((p ?? []).filter((r: Pos) => r.pos_amt !== 0)));
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;

  const totalPct = snap?.start_equity ? ((snap.equity / snap.start_equity - 1) * 100) : null;
  const slices = positions.map((p) => ({ label: p.symbol, value: Math.abs(p.pos_amt * p.price) }));

  return (
    <>
      <div className="pagetitle">Cuenta <span className="tag">KV-9014</span>
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
            <div className="metric"><div className="v">${fmtUsd(snap.equity)}</div><div className="l">Equity</div></div>
            <div className="metric"><div className="v">${fmtUsd(snap.wallet_balance)}</div><div className="l">Balance</div></div>
            <div className="metric"><div className={`v ${pnlClass(snap.unrealized_pnl)}`}>{fmtUsd(snap.unrealized_pnl)}</div><div className="l">PnL no realizado</div></div>
            <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">Total desde inicio</div></div>
            <div className="metric"><div className="v">${fmtUsd(snap.exposure_notional, 0)}</div><div className="l">Exposición</div></div>
            <div className="metric"><div className={`v ${pnlClass(snap.dd_pct)}`}>{fmtPct(snap.dd_pct)}</div><div className="l">Drawdown</div></div>
          </div>

          <div className="card">
            <h2>Posiciones abiertas ({positions.length})</h2>
            {positions.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Sin posiciones abiertas</div> : (
              <table>
                <thead><tr><th>Activo</th><th>Lado</th><th>Monto $</th><th>Entrada</th><th>Precio</th><th>uPnL</th><th>%</th></tr></thead>
                <tbody>
                  {positions.map((p) => {
                    const notional = Math.abs(p.pos_amt * p.price);
                    const pnlPct = p.entry_price
                      ? (p.price / p.entry_price - 1) * 100 * Math.sign(p.pos_amt)
                      : null;
                    return (
                      <tr key={p.symbol}>
                        <td>{p.symbol.replace("USDT", "")}</td>
                        <td className={p.side === "LARGO" ? "pos" : "neg"}>{p.side}</td>
                        <td>{fmtUsd(notional, 0)}</td>
                        <td>{fmtUsd(p.entry_price)}</td>
                        <td>{fmtUsd(p.price)}</td>
                        <td className={pnlClass(p.unrealized_pnl)}>{fmtUsd(p.unrealized_pnl)}</td>
                        <td className={pnlClass(pnlPct)}>{fmtPct(pnlPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>Composición de cartera</h2>
            <Donut slices={slices} />
          </div>

          <p className="note">Última actualización: {fmtDate(snap.ts)} · vela {fmtDate(snap.bar_time)}</p>
        </>
      )}
    </>
  );
}
