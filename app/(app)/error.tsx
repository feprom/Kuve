"use client";
import { useEffect } from "react";
import Link from "next/link";

/** Error dentro de la zona logueada. Al vivir bajo (app)/layout.tsx, la topbar
 *  y la bottom nav siguen en pie: el cliente puede irse a otra pantalla en vez
 *  de quedarse encerrado en una página muerta. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="card">
      <h2>No se ha podido mostrar esta pantalla</h2>
      <p className="note" style={{ marginTop: 0 }}>
        Es un fallo al mostrar la información, no en tu cuenta ni en tus fondos.
        Tus posiciones y tu saldo siguen intactos. Puedes reintentar o moverte a otra pantalla
        desde el menú inferior.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn" style={{ width: "auto" }} onClick={reset}>Reintentar</button>
        <Link href="/dashboard" className="btn secondary" style={{
          width: "auto", textDecoration: "none", display: "inline-block",
        }}>Ir al inicio</Link>
      </div>
      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Detalle técnico</summary>
        <p className="error-msg" style={{ wordBreak: "break-word" }}>{error.message}</p>
        {error.digest && <p className="note">Referencia: {error.digest}</p>}
      </details>
    </div>
  );
}
