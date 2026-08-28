"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mensajeAuth } from "@/lib/authErrors";
import Logo from "@/components/Logo";

/**
 * Pantalla a la que aterriza el cliente desde el correo de recuperación.
 *
 * QUÉ LLEGA EN LA URL. `createBrowserClient` de @supabase/ssr usa flujo PKCE,
 * así que Supabase redirige aquí con `?code=…` y el propio cliente lo canjea
 * por una sesión al montarse (`detectSessionInUrl`). Cuando el canje falla,
 * Supabase añade `?error=…&error_description=…` en su lugar.
 *
 * POR QUÉ NO UN TEMPORIZADOR FIJO. Esperar dos segundos y declarar el enlace
 * caducado es exactamente el fallo que un cliente con mala cobertura vería
 * siempre: el canje sigue en vuelo y la pantalla ya le ha dicho que no vale. Se
 * decide por lo que HAY en la URL: sin `code` ni sesión no hay nada que esperar
 * y se corta ya; con `code` se espera al desenlace real del canje, con un tope
 * generoso que solo salta si la red se cuelga del todo.
 */
type Estado = "comprobando" | "listo" | "invalido";

export default function Reset() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("comprobando");
  const [motivo, setMotivo] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    let vivo = true;
    const url = new URL(window.location.href);
    // El flujo implícito deja el token en el fragmento; el PKCE, en la query.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hayCodigo = !!(url.searchParams.get("code") || hash.get("access_token"));
    const errUrl = url.searchParams.get("error_description") || hash.get("error_description");

    const invalidar = (m: string | null) => { if (vivo) { setMotivo(m); setEstado("invalido"); } };

    if (errUrl) { invalidar(errUrl); return; }

    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (vivo && session) setEstado("listo");
    });

    sb.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data.session) { setEstado("listo"); return; }
      // Sin sesión y sin código en la URL no hay nada en vuelo: es un enlace
      // pegado a mano, ya usado o caducado. No tiene sentido esperar.
      if (!hayCodigo) invalidar(null);
    });

    // Tope de seguridad, solo por si el canje se queda colgado sin resolver.
    const tope = window.setTimeout(() => {
      setEstado((p) => (p === "comprobando" ? "invalido" : p));
    }, 12000);

    return () => { vivo = false; window.clearTimeout(tope); sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirm) { setError("Las dos contraseñas no coinciden."); return; }

    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) { setError(mensajeAuth(error)); setBusy(false); return; }
    router.push("/dashboard"); router.refresh();
  }

  const marco = (hijos: React.ReactNode) => (
    <div className="authwrap">
      <div className="authcard">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
        <div className="sub" style={{ textAlign: "center" }}>Nueva contraseña</div>
        {hijos}
      </div>
    </div>
  );

  if (estado === "comprobando")
    return marco(<p className="note" style={{ textAlign: "center" }}>Comprobando el enlace…</p>);

  if (estado === "invalido")
    return marco(
      <>
        <div className="error-msg" style={{ textAlign: "center" }}>
          Este enlace ya no sirve.
        </div>
        <p className="note" style={{ textAlign: "center" }}>
          Los enlaces caducan y solo valen una vez. Además, tienes que abrirlo en{" "}
          <b>el mismo navegador</b> desde el que lo pediste: si lo solicitaste en el
          ordenador y abres el correo en el móvil, no funcionará.
        </p>
        {motivo && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Detalle técnico</summary>
            <p className="note" style={{ wordBreak: "break-word" }}>{motivo}</p>
          </details>
        )}
        <p className="note" style={{ textAlign: "center" }}>
          <Link href="/forgot">Pedir un enlace nuevo</Link>
        </p>
      </>
    );

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
        <div className="sub" style={{ textAlign: "center" }}>Nueva contraseña</div>
        <label className="field">Contraseña nueva
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 required minLength={8} autoComplete="new-password" />
        </label>
        <label className="field">Repite la contraseña
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                 required minLength={8} autoComplete="new-password" />
        </label>
        <p className="note" style={{ textAlign: "center", marginTop: 0 }}>Mínimo 8 caracteres.</p>
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
      </form>
    </div>
  );
}
