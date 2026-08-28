import Link from "next/link";
import Logo from "@/components/Logo";

/** 404 del árbol completo. Sin hooks: se queda como server component. */
export default function NotFound() {
  return (
    <div className="authwrap">
      <div className="authcard">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><Logo height={96} /></div>
        <h1 style={{ textAlign: "center" }}>Esta página no existe</h1>
        <div className="sub" style={{ textAlign: "center" }}>
          La dirección que has abierto no corresponde a ninguna pantalla del portal.
          Tu cuenta y tus fondos no están afectados.
        </div>
        <Link href="/dashboard" className="btn" style={{
          display: "block", textAlign: "center", color: "var(--accent-ink)", textDecoration: "none",
        }}>Ir al inicio</Link>
      </div>
    </div>
  );
}
