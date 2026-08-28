"use client";
import { useEffect } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

/** Error boundary del árbol general: cubre las rutas que no están dentro del
 *  grupo (app) y hace de red por debajo del root layout. Sin este fichero,
 *  cualquier excepción de cliente acaba en la pantalla en blanco de Next. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="authwrap">
      <div className="authcard">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
        <h1 style={{ textAlign: "center" }}>Algo no se ha cargado</h1>
        <div className="sub" style={{ textAlign: "center" }}>
          Es un fallo al mostrar la información en pantalla. Tu cuenta y tus fondos no están afectados.
        </div>
        <button className="btn" onClick={reset}>Reintentar</button>
        <p className="note" style={{ textAlign: "center" }}>
          Si vuelve a ocurrir, <Link href="/dashboard">vuelve al inicio</Link>.
        </p>
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Detalle técnico</summary>
          <p className="error-msg" style={{ wordBreak: "break-word" }}>{error.message}</p>
          {error.digest && <p className="note">Referencia: {error.digest}</p>}
        </details>
      </div>
    </div>
  );
}
