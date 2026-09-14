"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import PinPad from "@/components/PinPad";
import InstalarApp from "@/components/InstalarApp";

/**
 * Alta por invitacion: el admin manda un enlace /invite/<token>; el cliente
 * elige un PIN de 6 digitos y ya tiene acceso. Sin contrasena ni correo de
 * confirmacion.
 *
 * Ruta ABIERTA en middleware.ts: vale con y sin sesion. La regla de negocio
 * vive en la DB (`invite_peek`, anon, solo nombre + email enmascarado) y en
 * /api/invite/accept (service role: crea el usuario y abre sesion por cookie).
 */
type Estado = "valida" | "usada" | "caducada" | "inexistente";
type Peek = { name: string; email_masked: string | null; estado: Estado };

const TEXTO_ESTADO: Record<Exclude<Estado, "valida">, { t: string; p: string }> = {
  usada: { t: "Este enlace ya se usó", p: "El acceso de esta invitación ya está creado. Si fuiste tú, entra con tu PIN; si no, pide un enlace nuevo." },
  caducada: { t: "Este enlace ha caducado", p: "Las invitaciones valen 7 días. Pide un enlace nuevo a quien te invitó." },
  inexistente: { t: "Este enlace no es válido", p: "Comprueba que lo has copiado entero o pide un enlace nuevo a quien te invitó." },
};

export default function InvitePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const token = (params.token ?? "").trim().toUpperCase();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [cargaErr, setCargaErr] = useState<string | null>(null);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [repitiendo, setRepitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailFinal, setEmailFinal] = useState<string | null>(null);
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabaseBrowser().rpc("invite_peek", { p_token: token });
      if (error) { setCargaErr("No se ha podido comprobar la invitación. Revisa tu conexión y vuelve a abrir el enlace."); return; }
      const fila = (Array.isArray(data) ? data[0] : data) as Peek | undefined;
      setPeek(fila ?? { name: "", email_masked: null, estado: "inexistente" });
    })();
  }, [token]);

  const coincide = pin1.length === 6 && pin1 === pin2;

  const onPrimero = useCallback((p: string) => {
    // Un PIN trivial lo rechaza el servidor (400), pero avisar aqui ahorra un viaje.
    if (/^(\d)\1{5}$/.test(p) || ["123456", "654321", "000000"].includes(p)) {
      setError("Ese PIN es demasiado fácil de adivinar. Elige otro.");
      setPin1("");
      return;
    }
    setError(null);
    setRepitiendo(true);
  }, []);

  const onSegundo = useCallback((p: string) => {
    setPin1((p1) => {
      if (p1 !== p) {
        setError("Los dos PIN no coinciden. Vuelve a empezar.");
        setPin2(""); setRepitiendo(false);
        return "";
      }
      setError(null);
      return p1;
    });
  }, []);

  async function crear() {
    if (!coincide || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin: pin1 }),
      });
      let body: { ok?: boolean; email?: string; error?: string; estado?: Estado } = {};
      try { body = await res.json(); } catch { /* sin JSON */ }
      if (res.status === 410 && body.estado) {
        const est = body.estado;
        setPeek((pk) => (pk ? { ...pk, estado: est } : pk));
        return;
      }
      if (!res.ok || !body.ok) {
        setError(body.error ?? `No se ha podido crear el acceso (${res.status}). Inténtalo de nuevo.`);
        setPin1(""); setPin2(""); setRepitiendo(false);
        return;
      }
      if (body.email) {
        try { window.localStorage.setItem("kuve_pin_email", body.email); } catch { /* modo privado */ }
        setEmailFinal(body.email);
      }
      setPaso(3);
    } catch {
      setError("No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function irAMiCuenta() {
    router.push("/dashboard"); router.refresh();
  }

  const cabecera = (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
  );

  if (cargaErr) return (
    <div className="authwrap"><div className="authcard">{cabecera}
      <h1>No se pudo abrir la invitación</h1>
      <p className="note">{cargaErr}</p>
    </div></div>
  );

  if (!peek) return (
    <div className="authwrap"><div className="authcard">{cabecera}
      <div className="skel" style={{ height: 22, width: "60%", marginBottom: 10 }} />
      <div className="skel" style={{ height: 14, width: "85%" }} />
    </div></div>
  );

  if (peek.estado !== "valida") {
    const tx = TEXTO_ESTADO[peek.estado];
    return (
      <div className="authwrap"><div className="authcard">{cabecera}
        <h1>{tx.t}</h1>
        <p className="note">{tx.p}</p>
        <p className="note" style={{ textAlign: "center", marginTop: 16 }}>
          ¿Ya tienes acceso? <Link href="/login">Entrar</Link>
        </p>
      </div></div>
    );
  }

  if (paso === 1) return (
    <div className="authwrap"><div className="authcard">{cabecera}
      <h1>Hola, {peek.name}</h1>
      <p className="sub">Te han invitado a KUVE Finance, el portal donde sigues tu cartera, tus resultados y tus informes.</p>
      {peek.email_masked ? (
        <p className="note">Tu acceso queda asociado a <b>{peek.email_masked}</b>.</p>
      ) : (
        <p className="note">Tu acceso no lleva email: entrarás solo con tu PIN desde este teléfono.</p>
      )}
      <p className="note" style={{ marginBottom: 16 }}>Solo tienes que elegir un PIN de 6 dígitos. Es lo único que necesitarás para entrar.</p>
      <button type="button" className="btn" onClick={() => setPaso(2)}>Elegir mi PIN</button>
    </div></div>
  );

  if (paso === 2) return (
    <div className="authwrap"><div className="authcard">{cabecera}
      <h1>{repitiendo ? "Repite tu PIN" : "Elige tu PIN"}</h1>
      <p className="sub">{repitiendo
        ? "Escríbelo otra vez para confirmar que lo recuerdas."
        : "6 dígitos que solo tú conozcas. Evita fechas evidentes o secuencias."}</p>
      {repitiendo ? (
        <PinPad key="pin2" value={pin2} onChange={setPin2} onComplete={onSegundo} label="Repite el PIN" disabled={busy} autoFocus />
      ) : (
        <PinPad key="pin1" value={pin1} onChange={setPin1} onComplete={onPrimero} label="Tu PIN" autoFocus />
      )}
      {error && <div className="error-msg" role="alert">{error}</div>}
      {coincide && (
        <button type="button" className="btn" style={{ marginTop: 14 }} onClick={crear} disabled={busy}>
          {busy ? "Creando…" : "Crear mi acceso"}
        </button>
      )}
      {repitiendo && !coincide && !busy && (
        <button type="button" className="btn secondary" style={{ marginTop: 14 }}
          onClick={() => { setPin1(""); setPin2(""); setRepitiendo(false); setError(null); }}>Empezar de nuevo</button>
      )}
    </div></div>
  );

  return (
    <div className="authwrap"><div className="authcard">{cabecera}
      <h1>{instalada ? "Todo listo" : "Instala KUVE en tu teléfono"}</h1>
      <p className="sub">Tu acceso está creado{emailFinal ? <>: <b>{emailFinal}</b></> : null}. Guarda ese email: es el que te pedirá la app junto a tu PIN si algún día entras desde otro dispositivo.</p>
      <InstalarApp onEstado={(e) => setInstalada(e === "instalada")} />
      <button type="button" className="btn secondary" style={{ marginTop: 16 }} onClick={irAMiCuenta}>Ir a mi cuenta</button>
    </div></div>
  );
}
