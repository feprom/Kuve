"use client";
/**
 * Feed de actividad de la cuenta (tabla events, RLS: el cliente solo ve lo suyo).
 * Timeline vertical — no tabla: mobile-first, con color por severidad y el
 * detalle técnico plegado en <details> (nunca en title=, invisible en touch).
 */
import { useState } from "react";
import { EventRow, eventLabel, tsRelativo, KINDS_RUIDO } from "@/lib/events";

const colorDe = (level: string | null) =>
  level === "error" ? "var(--red)" : level === "warn" ? "#e0b45d" : "var(--muted)";

export default function EventFeed({ eventos, max = 8, titulo = "Actividad reciente" }: {
  eventos: EventRow[]; max?: number; titulo?: string;
}) {
  const [todo, setTodo] = useState(false);
  const filtrados = todo ? eventos : eventos.filter((e) => !KINDS_RUIDO.has(e.kind ?? ""));
  const lista = filtrados.slice(0, max);
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
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Sin novedades — el bot opera con normalidad.</div>
      ) : (
        <div style={{ marginTop: 10, borderLeft: "1px solid var(--border)", paddingLeft: 14, display: "grid", gap: 10 }}>
          {lista.map((e) => (
            <div key={e.id} style={{ position: "relative" }}>
              <span aria-hidden style={{
                position: "absolute", left: -18.5, top: 5, width: 8, height: 8, borderRadius: 8,
                background: colorDe(e.level),
              }} />
              <div style={{ fontSize: 13.5, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{tsRelativo(e.ts)}</span>
                <span style={e.level === "error" ? { color: "var(--red)" } : undefined}>{eventLabel(e)}</span>
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
          ))}
        </div>
      )}
      <p className="note">Registro del bot sobre esta cuenta: adopciones, stops de seguridad, órdenes rechazadas e incidencias.
        Los eventos rutinarios (stops de seguridad horarios) se ocultan por defecto.</p>
    </div>
  );
}
