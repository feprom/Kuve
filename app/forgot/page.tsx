"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const sb = supabaseBrowser();
    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo height={96} />
        </div>
        <div className="sub" style={{ textAlign: "center" }}>
          Recupera tu contraseña
        </div>

        {!sent ? (
          <>
            <p className="note" style={{ textAlign: "center" }}>
              Te enviaremos un enlace para restablecerla.
            </p>
            <label className="field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <button className="btn" disabled={busy}>
              {busy ? "Enviando…" : "Enviar enlace"}
            </button>
            <p className="note" style={{ textAlign: "center" }}>
              <Link href="/login">Volver al acceso</Link>
            </p>
          </>
        ) : (
          <>
            <div className="note" style={{ textAlign: "center", marginTop: 8 }}>
              Si ese email tiene cuenta, te hemos enviado un enlace.
            </div>
            <p className="note" style={{ textAlign: "center" }}>
              <Link href="/login">Volver al acceso</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}