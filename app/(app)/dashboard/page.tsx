"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import AccountView from "@/components/AccountView";

/** Dashboard del cliente: la MISMA vista unificada (AccountView) que ve el
 *  admin al entrar a una cuenta — aquí, con la cuenta propia. */
export default function Dashboard() {
  const router = useRouter();
  const [client, setClient] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        // sesión rota o vencida en el navegador: al login, no "Sin datos"
        router.replace("/login");
        return;
      }
      const { data: c, error } = await sb.from("clients").select("*, risk_profiles(atr_mult, name)")
        .eq("auth_uid", user.id).maybeSingle();
      if (!alive) return;
      if (error) setErr(error.message);
      setClient(c);
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, []);

  if (loading) return (
    <>
      <div className="skel" style={{ height: 96, marginBottom: 10 }} />
      <div className="skel" style={{ height: 240, marginBottom: 14 }} />
      <div className="skel" style={{ height: 160 }} />
    </>
  );
  if (err) return (
    <div className="card"><h2>No se pudieron cargar los datos</h2>
      <p className="note">Error: {err}. Reintentá recargando la página; si persiste, avisanos.</p>
    </div>
  );
  if (!client) return (
    <div className="card"><h2>Tu cuenta aún no está vinculada</h2>
      <p className="note">Tu usuario existe pero no tiene una cuenta de cliente asociada. Escribinos para completar el alta.</p>
    </div>
  );

  return (
    <>
      <div className="pagetitle">{client.name || "Resumen"}
        <span className={`badge ${client.enabled ? "on" : "off"}`}>{client.enabled ? "ACTIVO" : "PARADO"}</span>
      </div>
      <AccountView client={client} />
    </>
  );
}
