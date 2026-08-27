"use client";
/**
 * Feed de actividad de la cuenta (tabla events, RLS: el cliente solo ve lo suyo).
 * Timeline agrupado por día, con ventana temporal (los incidentes viejos no
 * encabezan el dashboard), deduplicación (6 reintentos del mismo símbolo el
 * mismo día = una entrada ×6) y rojo que se apaga con la antigüedad.
 */
import { useState } from "react";
import { EventRow, eventLabel, tsRelativo, diaLabel, claveDedup, KINDS_RUIDO } from "@/lib/events";

const colorDe = (level: string | null) =>
  level === "error" ? "var(--red)" : level === "warn" ? "var(--warn)" : "var(--muted)";

export default function EventFeed({
  eventos, max = 8, titulo = "Actividad reciente", ventanaDias = 30,
}: {
  eventos: EventRow[]; max?: number; titulo?: string; ventanaDias?: number;
}) {
  const [todo, setTodo] = useState(false);
  const ahora = Date.now();
  const corte = ahora - ventanaDias * 86400e3;

  // 1) ventana temporal  2) ruido rutinario  3) dedup tipo+símbolo+día
  const base = eventos.filter((e) => todo || new Date(e.ts).getTime() >= corte);
  const sinRuido = todo ? base : base.filter((e) => !KINDS_RUIDO.has(e.kind ?? ""));
  const vistos = new Map<string, { e: EventRow; n: number }>();
  for (const e of sinRuido) {
    const k = claveDedup(e);
    const prev = vistos.get(k);
    if (prev) prev.n++; else vistos.set(k, { e, n: 1 });
  }
  const lista = Array.from(vistos.values()).slice(0, max);

  // agrupación por día (la lista ya viene descendente)
  const porDia: [string, { e: EventRow; n: number }[]][] = [];
  for (const it of lista) {
    const d = diaLabel(it.e.ts, ahora);
    const g = porDia[porDia.length - 1];
    if (g && g[0] === d) g[1].push(it); else porDia.push([d, [it]]);
  }

  if (!eventos.length) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {titulo}
        <button className="btn-mini" style={{ marginLeft: "auto" }} onClick={() => setTodo((v) => !v)}>
          {todo ? "Solo lo importante" : "Ver todo"}
        </button>
      </h2>
      {lista.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Sin novedades en los últimos {ventanaDias} días — el bot opera con normalidad.
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
          {porDia.map(([dia, items]) => (
            <div key={dia}>
              <div className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>{dia}</div>
              <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 14, display: "grid", gap: 10 }}>
                {items.map(({ e, n }) => {
                  const viejo = ahora - new Date(e.ts).getTime() > 7 * 86400e3;
                  return (
                    <div key={e.id} style={{ position: "relative" }}>
                      <span aria-hidden style={{
                        position: "absolute", left: -18.5, top: 5, width: 8, height: 8, borderRadius: 8,
                        background: colorDe(e.level), opacity: viejo ? 0.45 : 1,
                      }} />
                      <div style={{ fontSize: 13.5, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{tsRelativo(e.ts, ahora)}</span>
                        <span style={e.level === "error" && !viejo ? { color: "var(--red)" } : undefined}>
                          {eventLabel(e)}{n > 1 && <span className="muted"> · ×{n}</span>}
                        </span>
                      </div>
                      {e.detail && Object.keys(e.detail).length > 0 && (
                        <details style={{ marginTop: 2 }}>
                          <summary className="muted" style={{ fontSize: 11.5, cursor: "pointer" }}>detalle</summary>
                          <pre style={{
                            margin: "4px 0 0", padding: 8, fontSize: 11, lineHeight: 1.5, overflowX: "auto",
                            background: "rgba(255,255,255,.03)", borderRadius: 8, border: "1px solid var(--border)",
                          }}>{JSON.stringify(e.detail, null, 1)}</pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="note">Registro del bot sobre esta cuenta: adopciones, stops de seguridad, órdenes reintentadas e incidencias.
        Los eventos rutinarios (stops de seguridad horarios) se ocultan por defecto.</p>
    </div>
  );
}
