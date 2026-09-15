"use client";
import { fmtUsd } from "@/lib/format";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import PinPad from "@/components/PinPad";

const BOT_TELEGRAM = "KuveAgent_bot";

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
  // Conexion de Telegram por token: enlace t.me generado y espera de la
  // confirmacion (el linker del EC2 pasa cada 2 min; sondeamos 15 s / 5 min).
  const [tgEnlace, setTgEnlace] = useState<string | null>(null);
  const [tgEsperando, setTgEsperando] = useState(false);
  const tgTimer = useRef<{ iv: ReturnType<typeof setInterval>; fin: ReturnType<typeof setTimeout> } | null>(null);
  // Verificacion real de las claves: la hace el servidor de trading (unica IP
  // que Binance acepta) y deja el veredicto en key_checks. Sondeamos 3 s / 90 s.
  const [keyCheck, setKeyCheck] = useState<any>(null);
  const [verificando, setVerificando] = useState(false);
  const kcTimer = useRef<{ iv: ReturnType<typeof setInterval>; fin: ReturnType<typeof setTimeout> } | null>(null);
  // PIN opcional para clientes con contrasena.
  const [showPin, setShowPin] = useState(false);
  const [pinA, setPinA] = useState("");
  const [pinB, setPinB] = useState("");
  const [pinRepite, setPinRepite] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);

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
    if (c?.id) {
      const { data: kc } = await sb().from("key_checks").select("*").eq("client_id", c.id).maybeSingle();
      setKeyCheck(kc ?? null);
    }
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
        // La edge function no puede verificar (Binance solo acepta la IP del
        // servidor de trading): pedimos la verificacion real y esperamos.
        setApiKey(""); setApiSecret("");
        const { error } = await sb().rpc("request_key_check");
        if (error) {
          setMsg({ err: `Claves guardadas, pero no se pudo pedir la verificación (${error.message}).` });
        } else {
          setMsg({});
          esperarVerificacion();
        }
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

  function pararEsperaClaves() {
    if (kcTimer.current) { clearInterval(kcTimer.current.iv); clearTimeout(kcTimer.current.fin); kcTimer.current = null; }
    setVerificando(false);
  }
  function esperarVerificacion() {
    pararEsperaClaves();
    setVerificando(true);
    const iv = setInterval(() => { load(); }, 3000);
    const fin = setTimeout(() => {
      pararEsperaClaves();
      setMsg({ err: "El servidor no respondió a tiempo. Tus claves quedaron guardadas; vuelve a abrir esta pantalla en un minuto." });
    }, 90 * 1000);
    kcTimer.current = { iv, fin };
  }
  // En cuanto llega el veredicto, dejamos de sondear. Si falla, el formulario
  // se reabre para corregir en el acto.
  useEffect(() => {
    if (verificando && keyCheck?.checked_at) {
      pararEsperaClaves();
      if (keyCheck.ok) setShowKeys(false);
      else setShowKeys(true);
    }
    /* eslint-disable-next-line */
  }, [keyCheck?.checked_at]);
  useEffect(() => () => pararEsperaClaves(), []);

  function pararEsperaTelegram() {
    if (tgTimer.current) { clearInterval(tgTimer.current.iv); clearTimeout(tgTimer.current.fin); tgTimer.current = null; }
    setTgEsperando(false);
  }
  // En cuanto aparece el chat_id (tras un load() del sondeo) se deja de esperar.
  useEffect(() => { if (client?.telegram_chat_id) { pararEsperaTelegram(); setTgEnlace(null); } }, [client?.telegram_chat_id]);
  useEffect(() => () => pararEsperaTelegram(), []);

  async function conectarTelegram() {
    setBusy(true); setMsg({});
    const { data, error } = await sb().rpc("emit_telegram_link_token");
    setBusy(false);
    if (error) {
      const m = error.message ?? "";
      if (m.includes("ya_conectado")) { setMsg({ ok: "Tu Telegram ya está conectado." }); await load(); }
      else if (m.includes("sin_cliente")) setMsg({ err: "Tu usuario no tiene cuenta de cliente asociada todavía. Escríbenos para completar el alta." });
      else setMsg({ err: `No se pudo generar el enlace de Telegram (${m}). Inténtalo de nuevo en un momento.` });
      return;
    }
    const token = String(data ?? "").trim();
    if (!token) { setMsg({ err: "No se pudo generar el enlace de Telegram. Inténtalo de nuevo." }); return; }
    const url = `https://t.me/${BOT_TELEGRAM}?start=${token}`;
    setTgEnlace(url);
    // Safari/iOS bloquea window.open tras un await: si devuelve null, el boton
    // "Abrir Telegram" (enlace normal) queda en pantalla como alternativa.
    try { window.open(url, "_blank", "noopener"); } catch { /* bloqueado */ }
    pararEsperaTelegram();
    setTgEsperando(true);
    const iv = setInterval(() => { load(); }, 15000);
    const fin = setTimeout(() => pararEsperaTelegram(), 5 * 60 * 1000);
    tgTimer.current = { iv, fin };
  }

  function abrirPin() {
    setPinA(""); setPinB(""); setPinRepite(false); setPinErr(null); setShowPin(true);
  }
  function cerrarPin() { setShowPin(false); }

  function pinPrimero(p: string) {
    if (/^(\d)\1{5}$/.test(p) || ["123456", "654321", "000000"].includes(p)) {
      setPinErr("Ese PIN es demasiado fácil de adivinar. Elige otro."); setPinA(""); return;
    }
    setPinErr(null); setPinRepite(true);
  }
  async function pinSegundo(p: string) {
    if (p !== pinA) {
      setPinErr("Los dos PIN no coinciden. Vuelve a empezar."); setPinA(""); setPinB(""); setPinRepite(false); return;
    }
    setBusy(true); setPinErr(null);
    try {
      const res = await fetch("/api/pin/set", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: p }),
      });
      let body: { ok?: boolean; error?: string } = {};
      try { body = await res.json(); } catch { /* sin JSON */ }
      if (!res.ok || !body.ok) {
        setPinErr(body.error ?? `No se pudo guardar el PIN (${res.status}). Inténtalo de nuevo.`);
        setPinA(""); setPinB(""); setPinRepite(false);
        return;
      }
      // Para que /login ya venga con el email puesto y solo pida el PIN.
      try { if (client?.email) window.localStorage.setItem("kuve_pin_email", String(client.email).toLowerCase()); } catch { /* nada */ }
      setShowPin(false);
      setMsg({ ok: client?.pin_set_at ? "PIN cambiado. A partir de ahora entras con el nuevo." : "PIN creado. A partir de ahora entras con tu email y este PIN." });
      await load();
    } catch {
      setPinErr("No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
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
          <span className={`badge ${client.key_status === "valid" ? "on" : client.key_status === "pending" ? "neutral" : "off"}`}>claves: {({ valid: "válidas", pending: "verificando", invalid: "rechazadas", missing: "sin cargar" } as Record<string, string>)[client.key_status] ?? client.key_status}</span>
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
          <p className="note">Para recibirlo, primero conecta tu Telegram en el apartado «Avisos por Telegram»: sin tu chat no tenemos a dónde enviarlo.</p>
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
        {client.telegram_chat_id ? (
          <p className="note">
            {client.telegram_handle && <>Contacto: <b>@{client.telegram_handle}</b>{" "}</>}
            <span className="badge on" style={{ marginLeft: client.telegram_handle ? 6 : 0 }}>CONECTADO</span><br />
            Te llegan por Telegram las novedades de tu cuenta: aperturas, cierres e incidencias.</p>
        ) : (
          <>
            <p className="note">Recibe por Telegram las novedades de tu cuenta: aperturas y cierres de posiciones,
              e incidencias que requieran tu atención. Pulsa el botón, se abre el chat con{" "}
              <b>@{BOT_TELEGRAM}</b> y solo tienes que tocar <b>Iniciar</b>.</p>
            {tgEsperando ? (
              <>
                <p className="note"><span className="badge neutral">ESPERANDO CONFIRMACIÓN…</span><br />
                  Toca <b>Iniciar</b> en el chat del bot. En un par de minutos queda conectado y esta pantalla se actualiza sola.</p>
                {tgEnlace && (
                  <a href={tgEnlace} target="_blank" rel="noreferrer">
                    <button type="button" className="btn secondary" style={{ marginBottom: 8 }}>Abrir Telegram</button>
                  </a>
                )}
              </>
            ) : (
              <button type="button" className="btn" onClick={conectarTelegram} disabled={busy} style={{ marginBottom: 8 }}>
                {busy ? "Generando enlace…" : tgEnlace ? "Volver a intentarlo" : "Conectar Telegram"}
              </button>
            )}
            <details style={{ marginTop: 10 }}>
              <summary className="note" style={{ cursor: "pointer" }}>Si el botón no te funciona…</summary>
              <p className="note">Deja aquí tu usuario de Telegram y después escribe cualquier mensaje a{" "}
                <a href={`https://t.me/${BOT_TELEGRAM}`} target="_blank" rel="noreferrer"><b>@{BOT_TELEGRAM}</b></a>.
                {client.telegram_handle && <> Guardado: <b>@{client.telegram_handle}</b>{" "}
                  <span className="badge neutral">FALTA UN PASO</span></>}</p>
              <form onSubmit={saveTelegram} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label className="field" style={{ marginBottom: 0, minWidth: 200, flex: "1 1 200px" }}>Usuario de Telegram
                  <input value={telegram} onChange={(e) => setTelegram(e.target.value)}
                    placeholder="@tu_usuario" autoComplete="off" inputMode="text" />
                </label>
                <button className="btn secondary" disabled={busy || telegram.trim().replace(/^@/, "") === (client.telegram_handle ?? "")}>
                  Guardar
                </button>
              </form>
            </details>
          </>
        )}
      </div>

      <div className="card">
        <h2>Acceso con PIN</h2>
        {client.pin_set_at ? (
          <>
            <p className="note"><span className="badge on">PIN ACTIVO</span> desde {fmtDate(client.pin_set_at)}.<br />
              Entras con tu email y tu PIN de 6 dígitos.</p>
            <button type="button" className="btn secondary" onClick={abrirPin} disabled={busy}>Cambiar PIN</button>
          </>
        ) : (
          <>
            <p className="note">Un PIN de 6 dígitos para entrar desde el teléfono sin escribir la contraseña.
              <b> A partir de ese momento entras con el PIN; tu contraseña actual deja de valer.</b></p>
            <button type="button" className="btn secondary" onClick={abrirPin} disabled={busy}>Crear PIN</button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Claves API de Binance</h2>
        {(verificando || client.key_status === "pending") && !keyCheck?.checked_at && (
          <p className="note"><span className="badge neutral">VERIFICANDO CON BINANCE…</span> El servidor de trading está probando tus claves. Suele tardar menos de 10 segundos.</p>
        )}
        {keyCheck?.checked_at && (
          <p className="note" style={{ color: keyCheck.ok ? undefined : "var(--danger, #e5484d)" }}>
            <span className={`badge ${keyCheck.ok ? "on" : "off"}`}>{keyCheck.ok ? "VERIFICADAS" : "RECHAZADAS"}</span>{" "}
            {keyCheck.message} <span style={{ opacity: .6 }}>({fmtDate(keyCheck.checked_at)})</span>
          </p>
        )}
        {creds ? (
          <>
            <p className="note">Claves configuradas y verificadas por el servidor.</p>
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
              <p className="note">{client.key_status === "invalid" ? "Binance rechazó tus claves: corrígelas arriba." : client.key_status === "pending" ? "Esperando la verificación de tus claves." : "Configura primero tus claves API."}</p>
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

      {showPin && (
        <div className="modal-back" onClick={() => { if (!busy) cerrarPin(); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) cerrarPin(); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title"
            onClick={(e) => e.stopPropagation()}>
            <h3 id="pin-title">{pinRepite ? "Repite tu PIN" : client.pin_set_at ? "Nuevo PIN" : "Crea tu PIN"}</h3>
            {!pinRepite && !client.pin_set_at && (
              <p><b>A partir de ahora entras con este PIN; tu contraseña actual deja de valer.</b> Elige 6 dígitos que solo tú conozcas.</p>
            )}
            {!pinRepite && client.pin_set_at && <p>Elige 6 dígitos que solo tú conozcas. El PIN anterior dejará de valer.</p>}
            {pinRepite && <p>Escríbelo otra vez para confirmar que lo recuerdas.</p>}
            {pinRepite ? (
              <PinPad key="pinB" value={pinB} onChange={setPinB} onComplete={pinSegundo} label="Repite el PIN" disabled={busy} autoFocus />
            ) : (
              <PinPad key="pinA" value={pinA} onChange={setPinA} onComplete={pinPrimero} label="Tu PIN" disabled={busy} autoFocus />
            )}
            {pinErr && <div className="error-msg" role="alert">{pinErr}</div>}
            {busy && <p className="note" style={{ textAlign: "center" }}>Guardando…</p>}
            <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={cerrarPin} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

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
