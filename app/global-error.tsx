"use client";
import { useEffect } from "react";

/** Último recinto: sustituye al root layout, así que renderiza su propio
 *  <html>/<body> y no puede contar con globals.css cargado. Todos los estilos
 *  van inline, con los mismos tokens de la hoja global escritos en literal. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <html lang="es">
      <body style={{
        margin: 0, background: "#000", color: "#e8ecf4",
        fontFamily: "'Segoe UI', Roboto, Arial, sans-serif",
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}>
        <div style={{
          width: "100%", maxWidth: 400, background: "#0b0e13",
          border: "1px solid #1c2430", borderRadius: 14, padding: "28px 24px",
        }}>
          <div style={{
            fontFamily: "'Courier New', monospace", color: "#29a9e1", fontWeight: 700,
            letterSpacing: "0.06em", fontSize: 13, textAlign: "center", marginBottom: 16,
          }}>KUVE FINANCE</div>
          <h1 style={{ fontSize: 22, margin: "0 0 4px", textAlign: "center" }}>El portal no ha podido abrirse</h1>
          <p style={{ color: "#98a0b4", fontSize: 13, lineHeight: 1.5, margin: "0 0 22px", textAlign: "center" }}>
            Es un fallo al mostrar la información en pantalla. Tu cuenta y tus fondos no están afectados.
          </p>
          <button onClick={reset} style={{
            background: "#29a9e1", color: "#001018", border: "none", borderRadius: 9,
            padding: "11px 20px", fontWeight: 700, fontSize: 14, width: "100%",
            cursor: "pointer", fontFamily: "inherit",
          }}>Reintentar</button>
          <p style={{ color: "#98a0b4", fontSize: 12, marginTop: 8, textAlign: "center" }}>
            Si vuelve a ocurrir, <a href="/dashboard" style={{ color: "#29a9e1", textDecoration: "none" }}>vuelve al inicio</a>.
          </p>
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#98a0b4" }}>Detalle técnico</summary>
            <p style={{ color: "#e05d75", fontSize: 13, margin: "10px 0", wordBreak: "break-word" }}>{error.message}</p>
            {error.digest && <p style={{ color: "#98a0b4", fontSize: 12 }}>Referencia: {error.digest}</p>}
          </details>
        </div>
      </body>
    </html>
  );
}
