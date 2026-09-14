"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";

/**
 * Tarjeta "Invitaciones" del admin. Todo el estado vive aqui para no engordar
 * admin/page.tsx. Consume la RPC `admin_create_invite` y lee `client_invites`
 * por RLS (solo admins ven filas). Ver spec 2026-09-14-invitaciones-pin-telegram.
 */

/** Cliente existente sin usuario de auth: candidato a invitacion "de reenganche". */
export type ClienteSinAcceso = { id: string; name: string | null; email: string | null };

type Invite = {
  token: string;
  client_id: string | null;
  name: string;
  email: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

type Estado = "viva" | "usada" | "caducada";

function estadoDe(i: Invite, ahora: number): Estado {
  if (i.used_at) return "usada";
  if (new Date(i.expires_at).getTime() < ahora) return "caducada";
  return "viva";
}

const BADGE: Record<Estado, string> = { viva: "on", usada: "neutral", caducada: "off" };

/** Texto listo para pegar en WhatsApp/Telegram. El enlace es la unica credencial. */
const mensajeDe = (nombre: string, enlace: string) =>
  `Hola ${nombre}, este es tu acceso a KUVE Finance: ${enlace}. Caduca en 7 días.`;

export default function Invitaciones({ sinAcceso }: { sinAcceso: ClienteSinAcceso[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<{ nombre: string; enlace: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [puedeCompartir, setPuedeCompartir] = useState(false);

  async function cargar() {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("client_invites")
      .select("token, client_id, name, email, created_at, expires_at, used_at")
      .order("created_at", { ascending: false })
      .limit(50);
    // Si la tabla aun no existe (migracion sin aplicar) no rompemos el admin: lista vacia.
    if (!error && data) setInvites(data as Invite[]);
  }

  useEffect(() => {
    cargar();
    // navigator.share solo existe en movil/Safari; se decide en cliente tras montar.
    setPuedeCompartir(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  /** Emite (o reemite) una invitacion. La RPC revoca la viva del mismo client_id. */
  async function emitir(pName: string, pEmail: string | null, pClientId: string | null) {
    setBusy(true); setErr(null); setCopiado(false);
    try {
      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("admin_create_invite", {
        p_name: pName, p_email: pEmail, p_client_id: pClientId,
      });
      if (error) { setErr(error.message); return; }
      const token = String(data);
      setEmitida({ nombre: pName, enlace: `${location.origin}/invite/${token}` });
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setErr("El nombre es obligatorio"); return; }
    const m = email.trim().toLowerCase();
    await emitir(n, m || null, clientId || null);
  }

  /** Al elegir un cliente existente, precargamos su nombre y email para no teclearlos. */
  function elegirCliente(id: string) {
    setClientId(id);
    const c = sinAcceso.find((x) => x.id === id);
    if (c) { if (c.name && !name.trim()) setName(c.name); if (c.email && !email.trim()) setEmail(c.email); }
  }

  async function copiar() {
    if (!emitida) return;
    try {
      await navigator.clipboard.writeText(mensajeDe(emitida.nombre, emitida.enlace));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { setErr("No se pudo copiar; selecciona el texto y copialo a mano"); }
  }

  async function compartir() {
    if (!emitida) return;
    try {
      await navigator.share({ title: "Acceso a KUVE Finance", text: mensajeDe(emitida.nombre, emitida.enlace) });
    } catch { /* el usuario cancelo el dialogo: no es un error */ }
  }

  const ahora = Date.now();

  return (
    <details className="card">
      <summary><h2 style={{ display: "inline" }}>Invitaciones</h2></summary>

      <form onSubmit={onSubmit}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 180px" }}>Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" disabled={busy} />
          </label>
          <label className="field" style={{ flex: "1 1 220px" }}>Email (opcional)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
              placeholder="sin email → acceso solo con este enlace" disabled={busy} />
          </label>
          <label className="field" style={{ flex: "1 1 220px" }}>Cliente existente sin acceso
            <select value={clientId} onChange={(e) => elegirCliente(e.target.value)} disabled={busy}>
              <option value="">— cliente nuevo —</option>
              {sinAcceso.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}{c.email ? ` · ${c.email}` : ""}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn" type="submit" disabled={busy} style={{ maxWidth: 260 }}>
          {busy ? "Generando…" : "Generar enlace"}
        </button>
        {err && <p className="error-msg">{err}</p>}
        <p className="note">
          El enlace es la unica credencial del cliente: caduca a los 7 días y sirve una sola vez. Con él crea su PIN
          de 6 dígitos y entra sin contraseña. Sin email, la recuperación es siempre reinvitar.
        </p>
      </form>

      {emitida && (
        <div style={{ marginTop: 12 }}>
          <p className="ok-msg" style={{ marginBottom: 6 }}>Enlace para {emitida.nombre}:</p>
          <div className="field">
            <input readOnly value={emitida.enlace} onFocus={(ev) => ev.currentTarget.select()} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button className="btn secondary" type="button" onClick={copiar} style={{ flex: "1 1 140px" }}>
              {copiado ? "Copiado ✓" : "Copiar mensaje"}
            </button>
            {puedeCompartir && (
              <button className="btn secondary" type="button" onClick={compartir} style={{ flex: "1 1 140px" }}>Compartir</button>
            )}
          </div>
          <p className="note">{mensajeDe(emitida.nombre, emitida.enlace)}</p>
        </div>
      )}

      {invites.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table>
            <thead><tr><th>Token</th><th>Nombre</th><th>Email</th><th>Estado</th><th>Caduca</th><th></th></tr></thead>
            <tbody>{invites.map((i) => {
              const est = estadoDe(i, ahora);
              return (
                <tr key={i.token}>
                  <td style={{ fontFamily: "monospace" }} title={i.token}>{i.token.slice(0, 6)}…</td>
                  <td>{i.name}</td>
                  <td>{i.email ?? <span className="muted">interno</span>}</td>
                  <td><span className={`badge ${BADGE[est]}`}>{est}</span></td>
                  <td title={`Creada ${fmtDate(i.created_at)}`}>{fmtDate(i.expires_at)}</td>
                  <td>
                    {est !== "usada" && (
                      <button className="btn-mini" type="button" disabled={busy}
                        title="Genera un enlace nuevo con los mismos datos; el anterior deja de valer"
                        onClick={() => emitir(i.name, i.email, i.client_id)}>Reemitir</button>
                    )}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
