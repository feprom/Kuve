"use client";
import { fmtUsd } from "@/lib/format";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";

type Profile = { id: number; name: string; description: string; vol_target: number; max_leverage: number; min_equity_usdt: number };

export default function ProfilePage() {
  const router = useRouter();
  // supabaseBrowser() se llama DENTRO de cada handler: crearlo en el cuerpo
  // del componente rompe el prerender del build (sin env vars). Es singleton.
  const sb = () => supabaseBrowser();
  const [client, setClient] = useState<any>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [referidos, setReferidos] = useState<any[]>([]);
  const [bonos, setBonos] = useState(0);
  const [reglas, setReglas] = useState<any>(null);
  const [solicitud, setSolicitud] = useState<any>(null);
  const [copiado, setCopiado] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [creds, setCreds] = useState<any>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [telegram, setTelegram] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);

  async function load() {
   try {
    setLoadErr(null);
    const { data: { user } } = await sb().auth.getUser();
    // Sesion rota: sin esto la pagina quedaba en "Cargando…" para siempre, sin
    // acceso ni al boton de cerrar sesion. El dashboard ya redirige igual.
    if (!user) { router.replace("/login"); return; }
    const { data: adm } = await sb().from("admin_users").select("auth_uid").eq("auth_uid", user.id);
    setIsAdmin(!!adm?.length);
    // maybeSingle: con 0 filas .single() devuelve error y la página quedaba en
    // "Cargando…" para siempre, sin acceso ni al botón de cerrar sesión
    const { data: c } = await sb().from("clients").select("*").eq("auth_uid", user.id).maybeSingle();
    setClient(c); setName(c?.name ?? "");
    setTelegram(c?.telegram_handle ?? "");
    // El canje del codigo de invitacion ya NO vive aqui: lo hace
    // <ReclamaReferido /> desde el layout de (app), para que ocurra en la
    // primera pantalla que vea el invitado y no solo si abre su Perfil.
    if (c?.id) {
      const [refs, bon, rul, req] = await Promise.all([
        sb().from("referrals").select("id, invited_id, activated_at").eq("referrer_id", c.id),
        sb().from("client_compensations").select("monto_usd, estado").eq("client_id", c.id).eq("tipo", "bono").neq("estado", "anulado"),
        sb().from("referral_rules").select("bono_usd, tope_usd, activo").eq("id", 1).maybeSingle(),
        sb().from("report_requests").select("id, estado, solicitado_en").eq("client_id", c.id).order("solicitado_en", { ascending: false }).limit(1),
      ]);
      setReferidos(refs.data ?? []);
      setBonos((bon.data ?? []).reduce((a: number, x: any) => a + Number(x.monto_usd ?? 0), 0));
      setReglas(rul.data ?? null);
      setSolicitud((req.data ?? [])[0] ?? null);
    }
    const { data: p } = await sb().from("risk_profiles").select("*").order("id");
    setProfiles(p ?? []);
    // key metadata is not directly readable (no RLS policy) — key_status lives on clients
    setCreds(c?.key_status === "valid" ? { status: "valid" } : null);
   } catch (e: any) {
    setLoadErr(e?.message ?? String(e));
   } finally {
    // SIEMPRE, tambien tras un fallo: si no, la pantalla no sale de "Cargando…".
    setLoaded(true);
   }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function rpcSettings(fields: Record<string, unknown>) {
    setBusy(true); setMsg({});
    const { error } = await sb().rpc("update_client_settings", fields);
    if (error) setMsg({ err: error.message });
    else { setMsg({ ok: "Guardado. Los cambios se aplican en la próxima vela." }); await load(); }
    setBusy(false);
  }

  async function callEdge(fn: string, body: unknown) {
    const { data: { session } } = await sb().auth.getSession();
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
    // sin este check, un 502 con HTML rompía el .json(), la promesa quedaba sin
    // capturar y el formulario se bloqueaba en "Validando…" sin mensaje
    if (!res.ok) {
      let detail = `${res.status}`;
      try { detail = (await res.json()).error ?? detail; } catch { /* no era JSON */ }
      return { error: `El servidor respondió con un error (${detail}). Probá de nuevo en unos minutos.` };
    }
    return res.json();
  }

  async function saveKeys(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg({});
    try {
      const r = await callEdge("store-binance-keys", { api_key: apiKey, api_secret: apiSecret });
      if (r.error) setMsg({ err: r.error });
      else {
        setMsg({ ok: `Claves guardadas (····${r.last4}) · red detectada: ${r.network === "real" ? "REAL (mainnet)" : "TESTNET"}${r.warning ? ` · ${r.warning}` : ""}` });
        setApiKey(""); setApiSecret(""); setShowKeys(false);
        await load();
      }
    } catch (err) {
      setMsg({ err: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteKeys() {
    if (!confirm("¿Eliminar tus claves de Binance? El bot dejará de operar tu cuenta.")) return;
    setBusy(true);
    try {
      const r = await callEdge("delete-binance-keys", {});
      setMsg(r.error ? { err: r.error } : { ok: "Claves eliminadas." });
      await load();
    } catch (err) {
      setMsg({ err: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function saveTelegram(e: React.FormEvent) {
    e.preventDefault();
    const limpio = telegram.trim().replace(/^@/, "");
    if (limpio && !/^[A-Za-z0-9_]{5,32}$/.test(limpio)) {
      setMsg({ err: "Usuario de Telegram inválido: 5–32 caracteres, letras, números o guion bajo (sin @)." });
      return;
    }
    setBusy(true); setMsg({});
    const { error } = await sb().rpc("update_client_telegram", { p_telegram: limpio || null });
    if (error) setMsg({ err: error.message });
    else { setMsg({ ok: limpio ? `Contacto de Telegram guardado: @${limpio}.` : "Contacto de Telegram eliminado." }); await load(); }
    setBusy(false);
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
    await sb().auth.signOut();
    router.push("/login"); router.refresh();
  }

  if (!loaded) return <div className="muted">Cargando…</div>;
  if (loadErr) return (
    <div className="card"><h2>No se pudieron cargar los datos</h2>
      <p className="note">Error: {loadErr}. Reintentá recargando la página; si persiste, avisanos.</p>
    </div>
  );
  if (!client) return (
    <>
      <div className="card"><h2>Tu cuenta aún no está vinculada</h2>
        <p className="note">Tu usuario existe pero no tiene una cuenta de cliente asociada. Escribinos para completar el alta.</p>
      </div>
      <button className="btn secondary" onClick={logout}>Cerrar sesión</button>
    </>
  );
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

      {client.referral_code && reglas?.activo && (() => {
        const enlace = `${typeof window !== "undefined" ? window.location.origin : ""}/register?ref=${client.referral_code}`;
        const activados = referidos.filter((r) => r.activated_at).length;
        const tope = Number(reglas.tope_usd ?? 0), unit = Number(reglas.bono_usd ?? 0);
        const pct = tope > 0 ? Math.min(100, (bonos / tope) * 100) : 0;
        return (
          <div className="card">
            <h2>Invita y gana</h2>
            <p className="note">
              Gana <b>{fmtUsd(unit)} USD</b> por cada persona que abra su cuenta con tu enlace y empiece a operar,
              hasta <b>{fmtUsd(tope)} USD</b>. El bono se suma a tu <b>saldo en Kuve</b> y se cobra en la liquidación,
              igual que cualquier otro importe que Kuve te deba.
            </p>
            <div className="field" style={{ marginTop: 10 }}>
              <input readOnly value={enlace} onFocus={(ev) => ev.currentTarget.select()} />
            </div>
            <button className="btn secondary" style={{ marginTop: 8 }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
                catch { /* sin portapapeles: el campo ya es seleccionable */ }
              }}>{copiado ? "Enlace copiado" : "Copiar enlace"}</button>
            <div style={{ marginTop: 14 }}>
              <div style={{ height: 8, background: "var(--panel)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <p className="note" style={{ marginTop: 6 }}>
                <b>{fmtUsd(bonos)} USD</b> de {fmtUsd(tope)} · {activados} {activados === 1 ? "invitación activa" : "invitaciones activas"}
                {referidos.length > activados && ` · ${referidos.length - activados} sin activar todavía`}
              </p>
              {referidos.length > activados && (
                <p className="note">Una invitación se activa cuando esa persona habilita su bot y su cuenta supera el saldo mínimo:
                  hasta entonces no cuenta, para que el programa premie clientes reales y no cuentas vacías.</p>
              )}
            </div>
          </div>
        );
      })()}

      <div className="card">
        <h2>Tu informe mensual</h2>
        <p className="note">Te llega el día 1 de cada mes por Telegram. Si lo necesitas antes, pídelo aquí y te lo reenviamos.</p>
        {solicitud?.estado === "pendiente" ? (
          <p className="note"><b>Solicitud recibida.</b> Te llegará por Telegram en breve.</p>
        ) : (
          <button className="btn secondary" disabled={pidiendo || !client.telegram_chat_id}
            onClick={async () => {
              setPidiendo(true);
              const { error } = await sb().from("report_requests").insert({ client_id: client.id });
              setPidiendo(false);
              if (!error) setSolicitud({ estado: "pendiente" });
            }}>{pidiendo ? "Enviando…" : "Reenviarme el informe"}</button>
        )}
        {!client.telegram_chat_id && (
          <p className="note">Para recibirlo, primero escribe al bot desde el apartado de arriba: sin tu chat de Telegram no tenemos a dónde enviarlo.</p>
        )}
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
        <h2>Avisos por Telegram</h2>
        {client.telegram_handle ? (
          client.telegram_chat_id ? (
            <p className="note">Contacto: <b>@{client.telegram_handle}</b>{" "}
              <span className="badge on" style={{ marginLeft: 6 }}>CONECTADO</span><br />
              Te llegan por Telegram las novedades de tu cuenta: aperturas, cierres e incidencias.</p>
          ) : (
            <p className="note">Contacto: <b>@{client.telegram_handle}</b>{" "}
              <span className="badge neutral" style={{ marginLeft: 6 }}>FALTA UN PASO</span><br />
              Para activar los avisos, escribile cualquier mensaje a{" "}
              <a href="https://t.me/KuveAgent_bot" target="_blank" rel="noreferrer"><b>@KuveAgent_bot</b></a>{" "}
              desde tu Telegram. En unos minutos queda conectado y te confirmamos por ahí.</p>
          )
        ) : (
          <p className="note">Dejanos tu usuario de Telegram y te mandamos las novedades de tu cuenta:
            aperturas y cierres de posiciones, e incidencias que requieran tu atención.
            Después escribile un mensaje a{" "}
            <a href="https://t.me/KuveAgent_bot" target="_blank" rel="noreferrer"><b>@KuveAgent_bot</b></a>{" "}
            para completar la conexión.</p>
        )}
        <form onSubmit={saveTelegram} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="field" style={{ marginBottom: 0, minWidth: 200, flex: "1 1 200px" }}>Usuario de Telegram
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)}
              placeholder="@tu_usuario" autoComplete="off" inputMode="text" />
          </label>
          <button className="btn secondary" disabled={busy || telegram.trim().replace(/^@/, "") === (client.telegram_handle ?? "")}>
            Guardar
          </button>
        </form>
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
        <div className="modal-back" onClick={() => setShowDisable(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowDisable(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="disable-title"
            onClick={(e) => e.stopPropagation()}>
            <h3 id="disable-title">¿Qué hacemos con tus posiciones abiertas?</h3>
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
