"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mensajeAuth } from "@/lib/authErrors";
import Logo from "@/components/Logo";
import PinPad from "@/components/PinPad";

/**
 * Dos formas de entrar:
 *  - PIN (por defecto): email + 6 digitos contra /api/pin/login. El dispositivo
 *    recuerda el email en localStorage (`kuve_pin_email`, lo deja la pantalla
 *    de invitacion), asi que el cliente solo teclea el PIN.
 *  - Contrasena: el formulario de siempre, para los clientes antiguos.
 * El modo se recuerda en `kuve_login_modo` para quien use contrasena.
 */
const CLAVE_EMAIL = "kuve_pin_email";
const CLAVE_MODO = "kuve_login_modo";

export default function Login() {
  const router = useRouter();
  const [modo, setModo] = useState<"pin" | "password">("pin");
  const [email, setEmail] = useState("");
  const [emailFijo, setEmailFijo] = useState(false);   // prellenado y colapsado
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bloqueoHasta, setBloqueoHasta] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE_EMAIL);
      if (guardado) { setEmail(guardado); setEmailFijo(true); }
      if (window.localStorage.getItem(CLAVE_MODO) === "password") setModo("password");
    } catch { /* sin localStorage */ }
  }, []);

  // Cuenta atras del bloqueo (423): un segundo de reloj.
  useEffect(() => {
    if (!bloqueoHasta) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [bloqueoHasta]);
  const segRestantes = bloqueoHasta ? Math.max(0, Math.ceil((bloqueoHasta - ahora) / 1000)) : 0;
  useEffect(() => { if (bloqueoHasta && segRestantes === 0) { setBloqueoHasta(null); setError(null); } }, [bloqueoHasta, segRestantes]);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  const entrarPin = useCallback(async (p: string) => {
    const em = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) { setError("Escribe tu email para poder comprobar el PIN."); setPin(""); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/pin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, pin: p }),
      });
      let body: { ok?: boolean; error?: string; segundos?: number } = {};
      try { body = await res.json(); } catch { /* sin JSON */ }
      if (res.status === 423) {
        const seg = Number(body.segundos ?? 900);
        setBloqueoHasta(Date.now() + seg * 1000);
        setPin("");
        return;
      }
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Email o PIN incorrectos.");
        setPin("");
        return;
      }
      try { window.localStorage.setItem(CLAVE_EMAIL, em); window.localStorage.removeItem(CLAVE_MODO); } catch { /* nada */ }
      router.push("/dashboard"); router.refresh();
    } catch {
      setError("No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }, [email, router]);

  async function entrarPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setError(mensajeAuth(error)); setBusy(false); return; }
    try { window.localStorage.setItem(CLAVE_MODO, "password"); } catch { /* nada */ }
    router.push("/dashboard"); router.refresh();
  }

  function cambiarModo(m: "pin" | "password") {
    setModo(m); setError(null); setPin(""); setPassword("");
  }

  const cabecera = (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
      <div className="sub" style={{ textAlign: "center" }}>Acceso de clientes</div>
    </>
  );

  if (modo === "password") return (
    <div className="authwrap">
      <form className="authcard" onSubmit={entrarPassword}>
        {cabecera}
        <label className="field">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="field">Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <div className="error-msg" role="alert">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <p className="note" style={{ textAlign: "center" }}>
          <a href="#" onClick={(e) => { e.preventDefault(); cambiarModo("pin"); }}>Entrar con PIN</a>
          <br />
          ¿Sin cuenta? <Link href="/register">Regístrate</Link>
          <br />
          <Link href="/forgot">He olvidado mi contraseña</Link>
        </p>
      </form>
    </div>
  );

  const bloqueado = segRestantes > 0;
  const minRest = Math.ceil(segRestantes / 60);

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={(e) => { e.preventDefault(); if (pin.length === 6) entrarPin(pin); }}>
        {cabecera}
        {emailFijo ? (
          <p className="note" style={{ textAlign: "center", marginTop: 0, marginBottom: 14 }}>
            Entras como <b>{email}</b>{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setEmailFijo(false); }}>cambiar</a>
          </p>
        ) : (
          <label className="field">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
              autoFocus={!email} />
          </label>
        )}
        <PinPad value={pin} onChange={setPin} onComplete={entrarPin} label="Tu PIN"
          disabled={busy || bloqueado || !emailOk} autoFocus={emailFijo} />
        {!emailOk && !emailFijo && <p className="note" style={{ textAlign: "center" }}>Escribe tu email y después tu PIN.</p>}
        {bloqueado ? (
          <div className="error-msg" role="alert">
            Demasiados intentos. Prueba en {segRestantes >= 60 ? `${minRest} min` : `${segRestantes} s`}.
          </div>
        ) : error ? (
          <div className="error-msg" role="alert">{error}</div>
        ) : null}
        {busy && <p className="note" style={{ textAlign: "center" }}>Comprobando…</p>}
        <p className="note" style={{ textAlign: "center", marginTop: 16 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); cambiarModo("password"); }}>Entrar con contraseña</a>
          <br />
          ¿Sin cuenta? <Link href="/register">Regístrate</Link>
        </p>
      </form>
    </div>
  );
}
