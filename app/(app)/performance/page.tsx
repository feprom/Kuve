"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtUsd, fmtPct, pnlClass } from "@/lib/format";
import LineChart from "@/components/LineChart";
import PerfChart from "@/components/PerfChart";
import { attributeIncome, Attribution, IncomeRow } from "@/lib/pnl";
import {
  detectarFlujos, curvaTwr, serieBenchmark, benchmarkEnVentana, sanearSnaps,
  serieDrawdown, maxDrawdownTwr, twr, resumenCuenta } from "@/lib/metrics";
import { fetchSnaps, fetchIncome, fetchTrades, fetchOrdersFilled } from "@/lib/queries";

type Snap = { ts: string; bar_time: string; equity: number; unrealized_pnl: number; dd_pct: number; realized_cum: number; start_equity: number; n_trades: number };
type Bench = { date: string; equity_index: number };

export default function Performance() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [ledger, setLedger] = useState<IncomeRow[]>([]);
  const [attrib, setAttrib] = useState<Attribution | null>(null);
  const [bench, setBench] = useState<Bench[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const { data: c, error: ce } = await sb.from("clients")
          .select("id, risk_profile_id, risk_profiles(name)").eq("auth_uid", user.id).maybeSingle();
        if (ce) throw new Error(ce.message);
        if (c) {
          // carga paginada completa y saneada — la MISMA entrada que usa el
          // dashboard, para que las dos pantallas den el MISMO número
          const snapRows = sanearSnaps((await fetchSnaps(sb, c.id)) as unknown as Snap[]);
          if (!alive) return;
          setSnaps(snapRows);
          if (snapRows.length) {
            const [incRows, t, o] = await Promise.all([
              fetchIncome(sb, c.id, snapRows[0].ts),
              fetchTrades(sb, c.id),
              fetchOrdersFilled(sb, c.id),
            ]);
            if (!alive) return;
            setLedger(incRows as unknown as IncomeRow[]);
            setAttrib(attributeIncome(incRows as unknown as IncomeRow[], t as any[], o as any[]));
          }
          if (c.risk_profile_id) {
            const { data: b } = await sb.from("strategy_benchmark").select("date, equity_index")
              .eq("profile_id", c.risk_profile_id).order("date", { ascending: true });
            if (!alive) return;
            setBench(b ?? []);
          }
          setProfileName((c as any).risk_profiles?.name ?? "");
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

  // métricas canónicas de lib/metrics — memoizadas
  const met = useMemo(() => {
    const flujos = detectarFlujos(snaps, ledger);
    const heredadoFills = attrib?.heredadoFills ?? [];
    const curva = curvaTwr(snaps, flujos, heredadoFills);
    return { flujos, heredadoFills, curva };
  }, [snaps, ledger, attrib]);

  if (loading) return (
    <>
      <div className="skel" style={{ height: 96, marginBottom: 10 }} />
      <div className="skel" style={{ height: 240, marginBottom: 14 }} />
      <div className="skel" style={{ height: 160 }} />
    </>
  );
  if (err) return (
    <div className="card"><h2>No se pudieron cargar los datos</h2>
      <p className="note">Error: {err}. Reintentá recargando la página.</p></div>
  );

  const last = snaps[snaps.length - 1];
  const entryTs = snaps.length ? new Date(snaps[0].ts).getTime() : null;
  const { flujos, heredadoFills, curva } = met;

  // La comparación SIEMPRE en la misma ventana: la estrategia se rebasea a la
  // fecha de entrada del cliente (regla A2 de la auditoría — comparar contra el
  // YTD de la estrategia infla o hunde la diferencia por decenas de puntos).
  const stratPts = entryTs != null ? serieBenchmark(bench, entryTs) : [];
  const clientPts = curva.length > 1 ? curva.map((p) => ({ x: p.x, y: (p.y - 1) * 100 })) : [];
  const series = [
    { label: `Estrategia ${profileName}`.trim(), color: "var(--strategy)", points: stratPts },
    ...(clientPts.length > 1 ? [{ label: "Tu cuenta", color: "var(--accent)", points: clientPts }] : []),
  ].filter((s) => s.points.length > 1);

  // drawdown sobre la curva time-weighted (fuente única en lib/metrics)
  const ddPoints = serieDrawdown(curva);
  // FUENTE UNICA: la misma funcion que usa el dashboard. Antes cada pantalla
  // calculaba lo suyo y publicaban dos "rendimiento desde tu entrada" distintos.
  const res = resumenCuenta(snaps, flujos, heredadoFills, bench,
    { comisionFills: attrib?.comisionFills, fundingFills: attrib?.fundingFills });
  const totalPct = res.twrDesdeEntrada;
  const ddMax = res.ddMax;
  // Contra el indice NETO del arrastre real de esta cuenta: el bruto no descuenta
  // comisiones ni funding, asi que gana siempre y no por ser mejor gestion.
  const benchPct = res.benchNeto;

  return (
    <>
      <div className="pagetitle">Rendimiento</div>
      {!last && series.length === 0 ? (
        <div className="card"><p className="note">Aún no hay historial. Vuelve cuando el bot lleve unas horas operando.</p></div>
      ) : (
        <>
          <div className="metric-row">
            <div className="metric"
              title="Rendimiento time-weighted desde tu primera vela: mide la gestión. Los depósitos y retiros no cuentan como ganancia ni como pérdida.">
              <div className={`v ${pnlClass(totalPct)}`}>{fmtPct(totalPct)}</div><div className="l">Tu cuenta desde tu entrada</div>
            </div>
            <div className="metric"
              title="Lo que rindió la estrategia EN TU MISMA VENTANA (desde tu fecha de entrada hasta hoy). Es la comparación justa: mismo período para las dos curvas.">
              <div className={`v ${pnlClass(benchPct)}`}>{fmtPct(benchPct)}</div><div className="l">Estrategia en tu ventana</div>
            </div>
            <div className="metric" title="La mayor caída desde el punto más alto que tocó tu cuenta, ya descontados los movimientos de capital.">
              <div className={`v ${pnlClass(ddMax)}`}>{fmtPct(ddMax, 1)}</div><div className="l">Drawdown máx.</div>
            </div>
            <div className="metric"
              title="PnL realizado neto atribuido al bot según el ledger de Binance (cierres + comisiones + funding), excluyendo posiciones previas al bot. El mismo número que el dashboard.">
              <div className={`v ${pnlClass(attrib?.realizadoNeto ?? last?.realized_cum)}`}>{fmtUsd(attrib?.realizadoNeto ?? last?.realized_cum)}</div>
              <div className="l">PnL realizado (bot)</div>
            </div>
            <div className="metric"><div className="v">{last?.n_trades ?? 0}</div><div className="l">Trades</div></div>
          </div>

          <div className="card">
            <h2>Estrategia vs tu cuenta (desde tu entrada, en %)</h2>
            <PerfChart series={series} markerX={entryTs} markerLabel="Tu entrada" />
            <p className="note">Ambas curvas parten de 0% en tu fecha de entrada — misma ventana, directamente comparables.
              Verde: la estrategia KV-9014 con tu perfil, dibujada bruta. Azul: tu cuenta real. La cifra de arriba compara contra la estrategia NETA de los costos que tu cuenta pagó, que es la comparación válida.
              La curva azul es time-weighted: los depósitos y retiros mueven el tamaño de la cuenta, no la altura de la línea.</p>
          </div>

          {ddPoints.length > 1 && (
            <div className="card">
              <h2>Drawdown de tu cuenta</h2>
              <LineChart points={ddPoints} height={140} color="var(--red)" baseline={0} suffix="%" />
              <p className="note">Distancia al punto más alto que tocó tu cuenta, vela a vela, sobre el rendimiento
                time-weighted — un ingreso de capital sube el equity pero no el pico de referencia.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
