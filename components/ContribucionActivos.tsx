"use client";
import { useState } from "react";
import AssetName from "@/components/AssetName";
import { fmtUsd, fmtPct, pnlClass } from "@/lib/format";
import type { FilaActivo } from "@/lib/metrics";

/**
 * «Qué aportó cada activo» — la MISMA tabla que imprime el informe mensual y
 * que dibuja la tarjeta diaria, con las mismas cifras.
 *
 * ESTE COMPONENTE NO CALCULA NADA. Recibe `filas` y `total` tal como salen de
 * `metrics.contribucionPorActivo()`, que es la funcion que tambien alimenta al
 * motor de informes (`reportes/lib/informe.ts::porActivo`). Ni una suma, ni un
 * porcentaje, ni un redondeo se hacen aqui: si esta pantalla sumara la columna
 * por su cuenta, el cliente veria un total distinto del que acaba de leer en su
 * PDF — que es exactamente el fallo que la regla del proyecto prohibe.
 *
 * EL VEHICULO ES SVG PROPIO, no Lightweight Charts. Los charts de la app son
 * series temporales; esto es una comparacion categorica de ocho barras con eje
 * en cero. Meterlo en TradingView seria forzar una herramienta de series a un
 * grafico de barras divergentes, y anadir una libreria nueva por ocho
 * rectangulos no se justifica. Mismo criterio que Sparkline/Donut/LevelBar.
 */

const W = 160, H = 16;

/** Barra divergente con el cero en el centro. `max` es comun a toda la tabla:
 *  barras con escalas distintas mentirian sobre el tamaño relativo. */
function Barra({ v, max }: { v: number; max: number }) {
  const half = W / 2;
  const w = max > 0 ? Math.min(half, (Math.abs(v) / max) * half) : 0;
  const pos = v >= 0;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", marginLeft: "auto" }}
      role="img" aria-label={`${pos ? "aporta" : "resta"} ${Math.abs(v).toFixed(2)} dólares`}>
      <line x1={half} y1="1" x2={half} y2={H - 1} stroke="var(--grid)" strokeWidth="1" />
      <rect x={pos ? half : half - w} y="4" width={Math.max(w, v === 0 ? 0 : 1.5)} height={H - 8} rx="2"
        fill={pos ? "var(--green)" : "var(--red)"} opacity=".85" />
    </svg>
  );
}

export default function ContribucionActivos({ filas, total, capitalBase }: {
  filas: FilaActivo[]; total: FilaActivo; capitalBase: number;
}) {
  const [detalle, setDetalle] = useState(false);
  if (!filas.length) return null;

  // Escala comun. Solo lectura sobre importes ya calculados: elegir el maximo
  // no es calcular una cifra publicada, es decidir cuanto mide un rectangulo.
  const max = Math.max(...filas.map((f) => Math.abs(f.neto)), 0.01);
  const activos = filas.filter((f) => !f.esCartera);
  const cartera = filas.find((f) => f.esCartera) ?? null;
  const hayReparacion = Math.abs(total.reparacion) >= 0.005;

  const Fila = ({ f, nombre }: { f: FilaActivo; nombre: React.ReactNode }) => (
    <>
      <tr>
        <td>{nombre}</td>
        <td style={{ padding: "7px 0" }}><Barra v={f.neto} max={max} /></td>
        <td className={pnlClass(f.neto)} style={{ fontWeight: 600 }}>{fmtUsd(f.neto)}</td>
        <td className={pnlClass(f.pctCartera)}>{fmtPct(f.pctCartera)}</td>
      </tr>
      {detalle && (
        <tr>
          <td colSpan={4} style={{ padding: "0 8px 8px", borderBottom: "1px solid var(--border)" }}>
            <span className="note" style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: 0, fontSize: 11.5 }}>
              <span>Estrategia <b className={pnlClass(f.estrategia)}>{fmtUsd(f.estrategia)}</b></span>
              {Math.abs(f.fallaTecnica) >= 0.005 &&
                <span>Incidencias técnicas <b className={pnlClass(f.fallaTecnica)}>{fmtUsd(f.fallaTecnica)}</b></span>}
              {Math.abs(f.externo) >= 0.005 &&
                <span>Cierres ajenos <b className={pnlClass(f.externo)}>{fmtUsd(f.externo)}</b></span>}
              <span>Costos <b className={pnlClass(f.costos)}>{fmtUsd(f.costos)}</b></span>
              {Math.abs(f.reparacion) >= 0.005 &&
                <span>Reparación Kuve <b className="pos">{fmtUsd(f.reparacion)}</b></span>}
              {Math.abs(f.lucroCesante) >= 0.005 &&
                <span>Dejado de ganar <b className="neg">{fmtUsd(f.lucroCesante)}</b></span>}
              {f.nOps > 0 && <span className="muted">{f.nOps} cierres</span>}
            </span>
          </td>
        </tr>
      )}
    </>
  );

  return (
    <div className="card">
      <h2>Qué aportó cada activo (desde tu entrada)</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Activo</th>
              <th />
              <th>USD</th>
              <th>% cartera</th>
            </tr>
          </thead>
          <tbody>
            {activos.map((f) => (
              <Fila key={f.symbol} f={f} nombre={<AssetName symbol={f.symbol} />} />
            ))}
            {cartera && (Math.abs(cartera.neto) >= 0.005 || Math.abs(cartera.lucroCesante) >= 0.005) && (
              <Fila f={cartera} nombre={<span className="muted" style={{ fontSize: 11.5 }}>Cartera (parada del servicio)</span>} />
            )}
            <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td />
              <td className={pnlClass(total.neto)} style={{ fontWeight: 700 }}>{fmtUsd(total.neto)}</td>
              <td className={pnlClass(total.pctCartera)} style={{ fontWeight: 700 }}>{fmtPct(total.pctCartera)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <button className="btn secondary" style={{ marginTop: 10, fontSize: 12.5, padding: "7px 12px" }}
        onClick={() => setDetalle((d) => !d)} aria-expanded={detalle}>
        {detalle ? "Ocultar el desglose" : "Ver de dónde sale cada cifra"}
      </button>

      <p className="note">
        Es la misma tabla que aparece en tu informe mensual, con las mismas cifras: resultado
        realizado por activo desde tu fecha de entrada, ya descontadas las comisiones y el funding
        que pagó cada uno.
        {hayReparacion && " Incluye la reparación que Kuve reconoció, imputada al activo donde ocurrió la incidencia."}
      </p>
      <p className="note">
        El <b>% cartera</b> es cuánto pesa cada activo sobre tu capital aportado
        ({fmtUsd(capitalBase)} USD: inicial más aportes, menos retiros). No es el rendimiento
        time-weighted que ves arriba y no tiene por qué coincidir con él: aquél mide la gestión
        neutralizando cuándo entró tu dinero, y éste son dólares sobre dólares.
      </p>
    </div>
  );
}
