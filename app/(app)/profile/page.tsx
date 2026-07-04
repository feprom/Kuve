"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";

type Profile = { id: number; name: string; description: string; vol_target: number; max_leverage: number; min_equity_usdt: number };

export default function ProfilePage() {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [client, setClient] = useState<any>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [creds, setCreds] = useState<any>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  async function load() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { data: adm } = await sb.from("admin_users").select("auth_uid").eq("auth_uid", user.id);
    setIsAdmin(!!adm?.length);
    const { data: c } = await sb.from("clients").select("*").eq("auth_uid", user.id).single();
    setClient(c); setName(c?.name ?? "");
    const { data: p } = await sb.from("risk_profiles").select("*").order("id");
    setProfiles(p ?? []);
    // key metadata is not directly readable (no RLS policy) — key_status lives on clients
    setCreds(c?.key_status === "valid" ? { status: "valid" } : null);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function rpcSettings(fields: Record<string, unknown>) {
    setBusy(true); setMsg({});
    const { error } = await sb.rpc("update_client_settings", fields);
    if (error) setMsg({ err: error.message });
    else { setMsg({ ok: "Guardado. Los cambios se aplican en la próxima vela." }); await load(); }
    setBusy(false);
  }

  async function callEdge(fn: string, body: unknown) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${fn}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify(body),
      });
    return res.json();
  }

  async function saveKeys(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg({});
    const r = await callEdge("store-binance-keys", { api_key: apiKey, api_secret: apiSecret });
    if (r.error) setMsg({ err: r.error });
    else {
      setMsg({ ok: `Claves guardadas (····${r.last4}) · red detectada: ${r.network === "real" ? "REAL (mainnet)" : "TESTNET"}${r.warning ? ` · ${r.warning}` : ""}` });
      setApiKey(""); setApiSecret(""); setShowKeys(false);
      await load();
    }
    setBusy(false);
  }

  async function deleteKeys() {
    if (!confirm("¿Eliminar tus claves de Binance? El bot dejará de operar tu cuenta.")) return;
    setBusy(true);
    const r = await callEdge("delete-binance-keys", {});
    setMsg(r.error ? { err: r.error } : { ok: "Claves eliminadas." });
    await load(); setBusy(false);
  }

  async function toggleEnabled() {
    if (client.enabled) setShowDisable(true);
    else await rpcSettings({ p_enabled: true });  // registers an activation REQUEST
  }

  async function confirmDisable(mode: "flatten" | "wind_down") {
    setShowDisable(false);
    await rpcSettings({ p_enabled: false, p_disable_mode: mode });
  }

  async function logout() {
    await sb.auth.signOut();
    router.push("/login"); router.refresh();
  }

  if (!client) return <div className="muted">Cargando…</div>;
  const selProfile = profiles.find((p) => p.id === client.risk_profile_id);

  return (
    <>
      <div className="pagetitle">Perfil</div>

      <div className="card">
        <h2>Cliente</h2>
        <label className="field">Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="note" style={{ marginBottom: 12 }}>
          {client.email && <>Correo: <b>{client.email}</b><br /></>}
          {client.created_at && <>Usuario desde: {new Date(client.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</>}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
          <span className={`badge ${client.enabled ? "on" : "off"}`}>{client.enabled ? "BOT ACTIVO" : "BOT PARADO"}</span>
          <span className="badge neutral">modo: {client.mode}</span>
          <span className={`badge ${client.key_status === "valid" ? "on" : "off"}`}>claves: {client.key_status}</span>
        </div>
        <button className="btn secondary" disabled={busy || name === client.name}
          onClick={() => rpcSettings({ p_name: name })}>Guardar nombre</button>
      </div>

      <div className="card">
        <h2>Perfil de riesgo</h2>
        <label className="field">Setup
          <select value={client.risk_profile_id ?? ""} disabled={busy}
            onChange={(e) => rpcSettings({ p_risk_profile_id: Number(e.target.value) })}>
            <option value="" disabled>Selecciona un perfil…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — vol {Math.round(p.vol_target * 100)}% · x{p.max_leverage}</option>
            ))}
          </select>
        </label>
        {selProfile && (
          <p className="note">{selProfile.description} Equity mínimo recomendado: ${selProfile.min_equity_usdt}.
            Un cambio de perfil se aplica en la próxima vela horaria.</p>
        )}
      </div>

      <div className="card">
        <h2>Claves API de Binance</h2>
        {creds ? (
          <>
            <p className="note">Claves configuradas y validadas. Última verificación: {fmtDate(client.updated_at) !== "—" ? fmtDate(client.updated_at) : "reciente"}.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn secondary" onClick={() => setShowKeys(true)} disabled={busy}>Reemplazar</button>
              <button className="btn danger" onClick={deleteKeys} disabled={busy}>Eliminar</button>
            </div>
          </>
        ) : (
          <>
            <p className="note">Crea en Binance una clave API con permiso <b>solo de futuros</b> (sin retiros)
              y restringida a la IP del servidor. La red (real o testnet) se detecta automáticamente.
              Nunca compartas la clave con nadie más.</p>
            <button className="btn" onClick={() => setShowKeys(true)}>Añadir claves</button>
          </>
        )}
        {showKeys && (
          <form onSubmit={saveKeys} style={{ marginTop: 14 }}>
            <label className="field">API Key
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} required autoComplete="off" />
            </label>
            <label className="field">API Secret
              <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required autoComplete="off" />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={busy}>{busy ? "Validando…" : "Validar y guardar"}</button>
              <button type="button" className="btn secondary" onClick={() => setShowKeys(false)}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Bot de trading</h2>
        {client.enabled ? (
          <>
            <p className="note">El bot está operando tu cuenta cada hora según tu perfil de riesgo.</p>
            <button className="btn danger" onClick={toggleEnabled} disabled={busy}>Desactivar bot</button>
          </>
        ) : client.activation_requested ? (
          <>
            <span className="badge neutral">ACTIVACIÓN PENDIENTE DE APROBACIÓN</span>
            <p className="note">Tu solicitud fue enviada. El administrador revisará tu cuenta y activará el bot; recibirás el alta normalmente en menos de 24&nbsp;h.</p>
          </>
        ) : (
          <>
            <p className="note">Cuando tus claves estén configuradas y hayas elegido perfil, solicita la activación: el administrador revisa tu cuenta y da el alta final.</p>
            <button className="btn" onClick={toggleEnabled}
              disabled={busy || client.key_status !== "valid" || !client.risk_profile_id}>
              Solicitar activación
            </button>
            {client.key_status !== "valid" && (
              <p className="note">Configura primero tus claves API.</p>
            )}
          </>
        )}
      </div>

      {msg.err && <div className="error-msg">{msg.err}</div>}
      {msg.ok && <div className="ok-msg">{msg.ok}</div>}

      {isAdmin && (
        <a href="/admin"><button className="btn" style={{ marginBottom: 10 }}>Panel de administración</button></a>
      )}
      <button className="btn secondary" onClick={logout}>Cerrar sesión</button>

      {showDisable && (
        <div className="modal-back" onClick={() => setShowDisable(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Qué hacemos con tus posiciones abiertas?</h3>
            <p><b>Cerrar ahora:</b> el bot cierra todas tus posiciones a mercado en el próximo ciclo y se detiene.</p>
            <p><b>Dejar terminar:</b> no abre posiciones nuevas, pero gestiona las abiertas con sus stops hasta que salgan solas. Sigues expuesto mientras tanto.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => confirmDisable("flatten")}>Cerrar ahora</button>
              <button className="btn secondary" onClick={() => confirmDisable("wind_down")}>Dejar terminar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
