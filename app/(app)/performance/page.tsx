"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, pnlClass } from "@/lib/format";
import LineChart from "@/components/LineChart";
import PerfChart from "@/components/PerfChart";

type Snap = { ts: string; bar_time: string; equity: number; dd_pct: number; realized_cum: number; start_equity: number; n_trades: number };
type Bench = { date: string; equity_index: number };

export default function Performance() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [bench, setBench] = useState<Bench[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients")
        .select("id, risk_profile_id, risk_profiles(name)").eq("auth_uid", user.id).single();
      if (c) {
        const { data: s } = await sb.from("account_snapshots")
          .select("ts, bar_time, equity, dd_pct, realized_cum, start_equity, n_trades")
          .eq("client_id", c.id).order("ts", { ascending: true }).limit(5000);
        setSnaps(s ?? []);
        if (c.risk_profile_id) {
          const { data: b } = await sb.from("strategy_benchmark").select("date, equity_index")
            .eq("profile_id", c.risk_profile_id).order("date", { ascending: true });
          setBench(b ?? []);
        }
        setProfileName((c as any).risk_profiles?.name ?? "");
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;

  const last = snaps[snaps.length - 1];
  const stratPts = bench.map((b) => ({ x: new Date(b.date + "T00:00:00Z").getTime(), y: b.equity_index - 100 }));
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;

  // anchor the client's own curve at the strategy's % on their entry date,
  // so both lines are directly comparable from that point on
  let clientPts: { x: number; y: number }[] = [];
  if (entryTs != null && last?.start_equity) {
    let anchor = 0;
    for (const p of stratPts) if (p.x <= entryTs) anchor = p.y;
    clientPts = snaps.map((s) => ({
      x: new Date(s.ts).getTime(),
      y: anchor + (s.equity / last.start_equity - 1) * 100,
    }));
  }
  const series = [
    { label: `Estrategia ${profileName}`.trim(), color: "#3d996f", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: "Tu cuenta", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);

  const ddPoints = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: s.dd_pct }));
  const totalPct = last?.start_equity ? (last.equity / last.start_equity - 1) * 100 : null;
  const benchPct = stratPts.length ? stratPts[stratPts.length - 1].y : null;

  return (
    <>
      <div className="pagetitle">Rendimiento</div>
      {!last && series.length === 0 ? (
        <div className="card"><p className="note">Aún no hay historial. Vuelve cuando el bot lleve unas horas operando.</p></div>
      ) : (
        <>
          <div className="metric-row">
            <div className="metric"><div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">Tu cuenta desde tu entrada</div></div>
            <div className="metric"><div className={`v ${pnlClass(benchPct)}`}>{fmtPct(benchPct)}</div><div className="l">Estrategia desde 01/01</div></div>
            <div className="metric"><div className={`v ${pnlClass(last?.realized_cum)}`}>{last ? fmtUsd(last.realized_cum) : "—"}</div><div className="l">PnL realizado</div></div>
            <div className="metric"><div className="v">{last?.n_trades ?? 0}</div><div className="l">Trades</div></div>
          </div>

          <div className="card">
            <h2>Estrategia vs tu cuenta (YTD, en %)</h2>
            <PerfChart series={series} markerX={entryTs} markerLabel="Tu entrada" />
            <p className="note">Verde: la estrategia KV-9014 con tu perfil, del 1 de enero a hoy (bruto, sin comisiones).
              Azul: tu cuenta real, anclada al nivel de la estrategia en tu fecha de entrada — si las líneas van juntas, tu cuenta replica bien la estrategia.</p>
          </div>

          {ddPoints.length > 1 && (
            <div className="card">
              <h2>Drawdown de tu cuenta</h2>
              <LineChart points={ddPoints} height={140} color="var(--red)" baseline={0} suffix="%" />
            </div>
          )}
        </>
      )}
    </>
  );
}
