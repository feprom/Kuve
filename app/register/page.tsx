"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signUp({
      email, password, options: { data: { name } },
    });
    if (error) { setError(error.message); setBusy(false); return; }
    setDone(true);
  }

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
        <h1 style={{ textAlign: "center" }}>Crear cuenta</h1>
        {done ? (
          <div>
            <div className="ok-msg">Cuenta creada. Revisa tu email para confirmar y después <Link href="/login">inicia sesión</Link>.</div>
          </div>
        ) : (
          <>
            <label className="field">Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field">Contraseña
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </label>
            {error && <div className="error-msg">{error}</div>}
            <button className="btn" disabled={busy}>{busy ? "Creando…" : "Crear cuenta"}</button>
            <p className="note" style={{ textAlign: "center" }}>
              ¿Ya tienes cuenta? <Link href="/login">Entrar</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
