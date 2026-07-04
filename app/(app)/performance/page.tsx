"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, pnlClass } from "@/lib/format";
import LineChart from "@/components/LineChart";
import Donut from "@/components/Donut";

type Snap = { ts: string; bar_time: string; equity: number; dd_pct: number; realized_cum: number; start_equity: number; n_trades: number };
type PosRow = { id: number; symbol: string; pos_amt: number; price: number };
type Bench = { date: string; equity_index: number };

export default function Performance() {
  const [tab, setTab] = useState<"equity" | "dd" | "estrategia" | "asignacion">("equity");
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [bench, setBench] = useState<Bench[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [slices, setSlices] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: c } = await sb.from("clients")
        .select("id, risk_profile_id, risk_profiles(name)").eq("auth_uid", user.id).single();
      if (c) {
        const [{ data: s }, { data: b }] = await Promise.all([
          sb.from("account_snapshots")
            .select("ts, bar_time, equity, dd_pct, realized_cum, start_equity, n_trades")
            .eq("client_id", c.id).order("ts", { ascending: true }).limit(5000),
          c.risk_profile_id
            ? sb.from("strategy_benchmark").select("date, equity_index")
                .eq("profile_id", c.risk_profile_id).order("date", { ascending: true })
            : Promise.resolve({ data: [] as Bench[] }),
        ]);
        const rows = s ?? [];
        setSnaps(rows);
        setBench((b as any)?.data ?? (b as any) ?? []);
        setProfileName((c as any).risk_profiles?.name ?? "");
        const last = rows[rows.length - 1];
        if (last) {
          const { data: p } = await sb.from("positions").select("id, symbol, pos_amt, price")
            .eq("client_id", c.id).eq("bar_time", last.bar_time);
          const seen = new Map<string, PosRow>();
          for (const r of (p ?? []) as PosRow[]) {
            const prev = seen.get(r.symbol);
            if (!prev || r.id > prev.id) seen.set(r.symbol, r);
          }
          setSlices(Array.from(seen.values()).filter((r) => r.pos_amt !== 0)
            .map((r) => ({ label: r.symbol, value: Math.abs(r.pos_amt * r.price) })));
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;

  const last = snaps[snaps.length - 1];
  const eqPoints = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: s.equity }));
  const ddPoints = snaps.map((s) => ({ x: new Date(s.ts).getTime(), y: s.dd_pct }));
  const benchPoints = (bench ?? []).map((b) => ({ x: new Date(b.date + "T00:00:00Z").getTime(), y: b.equity_index }));
  const totalPct = last?.start_equity ? (last.equity / last.start_equity - 1) * 100 : null;
  const benchPct = benchPoints.length ? benchPoints[benchPoints.length - 1].y - 100 : null;

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "equity", label: "Equity" }, { id: "dd", label: "DD" },
    { id: "estrategia", label: "Estrategia" }, { id: "asignacion", label: "Cartera" },
  ];

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

          <div className="tabs">
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</div>
            ))}
          </div>

          {tab === "equity" && (
            <div className="card">
              <h2>Curva de equity (desde el inicio de tu cuenta)</h2>
              <LineChart points={eqPoints} baseline={last.start_equity} />
            </div>
          )}

          {tab === "dd" && (
            <div className="card">
              <h2>Drawdown</h2>
              <LineChart points={ddPoints} height={150} color="var(--red)" baseline={0} suffix="%" />
            </div>
          )}

          {tab === "estrategia" && (
            <div className="card">
              <h2>Estrategia KV-9014 · YTD {profileName && `· ${profileName}`}
                {benchPct != null && <span className={pnlClass(benchPct)} style={{ marginLeft: 8 }}>{fmtPct(benchPct)}</span>}
              </h2>
              {benchPoints.length < 2
                ? <p className="note">La curva de la estrategia se publica una vez al día desde el bot. Vuelve mañana si acaba de arrancar.</p>
                : <LineChart points={benchPoints} baseline={100} color="var(--green)" />}
              <p className="note">Simulación bruta de la estrategia con tu perfil de riesgo, del 1 de enero a hoy (índice 100 = 01/01, sin comisiones). No es tu cuenta real.</p>
            </div>
          )}

          {tab === "asignacion" && (
            <div className="card">
              <h2>Asignación actual</h2>
              <Donut slices={slices} />
            </div>
          )}
        </>
      )}
    </>
  );
}
