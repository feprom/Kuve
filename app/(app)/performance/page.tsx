"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, pnlClass } from "@/lib/format";
import LineChart from "@/components/LineChart";
import Donut from "@/components/Donut";

type Snap = { ts: string; bar_time: string; equity: number; dd_pct: number; realized_cum: number; start_equity: number; n_trades: number };

export default function Performance() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [slices, setSlices] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients").select("id").eq("auth_uid", user.id).single();
      if (c) {
        const { data: s } = await sb.from("account_snapshots")
          .select("ts, bar_time, equity, dd_pct, realized_cum, start_equity, n_trades")
          .eq("client_id", c.id).order("ts", { ascending: true }).limit(2000);
        const rows = s ?? [];
        setSnaps(rows);
        const last = rows[rows.length - 1];
        if (last) {
          const { data: p } = await sb.from("positions").select("symbol, pos_amt, price")
            .eq("client_id", c.id).eq("bar_time", last.bar_time);
          setSlices((p ?? []).filter((r: any) => r.pos_amt !== 0)
            .map((r: any) => ({ label: r.symbol, value: Math.abs(r.pos_amt * r.price) })));
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;
  const last = snaps[snaps.length - 1];
  const eqPoints = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: s.equity }));
  const ddPoints = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: s.dd_pct }));
  const totalPct = last?.start_equity ? (last.equity / last.start_equity - 1) * 100 : null;

  return (
    <>
      <div className="pagetitle">Rendimiento</div>
      {!last ? (
        <div className="card"><p className="note">Aún no hay historial de equity. Vuelve cuando el bot lleve unas horas operando.</p></div>
      ) : (
        <>
          <div className="metric-row">
            <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">Progreso total</div></div>
            <div className="metric"><div className={`v ${pnlClass(last.realized_cum)}`}>{fmtUsd(last.realized_cum)}</div><div className="l">PnL realizado</div></div>
            <div className="metric"><div className="v">{last.n_trades}</div><div className="l">Trades</div></div>
            <div className="metric"><div className={`v ${pnlClass(last.dd_pct)}`}>{fmtPct(last.dd_pct)}</div><div className="l">Drawdown actual</div></div>
          </div>

          <div className="card">
            <h2>Curva de equity</h2>
            <LineChart points={eqPoints} baseline={last.start_equity} />
          </div>

          <div className="card">
            <h2>Drawdown</h2>
            <LineChart points={ddPoints} height={120} color="var(--red)" baseline={0} />
          </div>

          <div className="card">
            <h2>Asignación actual</h2>
            <Donut slices={slices} />
          </div>
        </>
      )}
    </>
  );
}
