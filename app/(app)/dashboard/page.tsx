"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import AccountView from "@/components/AccountView";

/** Dashboard del cliente: la MISMA vista unificada (AccountView) que ve el
 *  admin al entrar a una cuenta — aquí, con la cuenta propia. */
export default function Dashboard() {
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: c } = await sb.from("clients").select("*, risk_profiles(atr_mult, name)")
        .eq("auth_uid", user.id).single();
      setClient(c);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="muted">Cargando…</div>;
  if (!client) return (
    <div className="card"><h2>Sin datos aún</h2>
      <p className="note">Comprueba en Perfil que tus claves de Binance están configuradas y el bot activado.</p>
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
