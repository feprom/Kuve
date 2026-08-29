"use client";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Canjea el codigo de invitacion en cuanto el invitado entra a CUALQUIER
 * pantalla de la zona logueada.
 *
 * POR QUE NO SE QUEDA EN /profile, que es donde estaba. El codigo llega en
 * `/register?ref=...` y se guarda en localStorage, porque al registrarse todavia
 * no existe la fila de `clients` a la que vincularlo. Se canjeaba despues, si el
 * invitado abria su Perfil — y ahi esta el problema: tras iniciar sesion se
 * aterriza en el panel, no en el perfil. Alguien podia registrarse por una
 * invitacion, operar meses y no visitar nunca esa pantalla, y la invitacion no
 * quedaba registrada. El invitador no cobraba su bono y nadie se enteraba,
 * porque no hay error que mirar: simplemente no pasa nada.
 *
 * Montado en el layout de (app), se intenta en la primera pantalla que vea.
 *
 * ES IDEMPOTENTE Y BARATO. Si no hay codigo guardado no toca la red siquiera.
 * El RPC `set_referred_by` (migracion 20260828_07) ignora el intento si el
 * cliente ya tiene invitador o si el codigo es el suyo propio, asi que la
 * barrera de verdad esta en la DB, no aqui. El codigo se borra pase lo que pase:
 * dejarlo haria reintentar un codigo invalido en cada carga de pagina para
 * siempre.
 */
export default function ReclamaReferido() {
  useEffect(() => {
    let vivo = true;
    (async () => {
      let pend: string | null = null;
      try {
        pend = window.localStorage.getItem("kuve_ref");
      } catch {
        return;   // navegador con almacenamiento bloqueado: no es un error
      }
      if (!pend) return;

      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!vivo || !user) return;

      const { data: c } = await sb.from("clients")
        .select("id, referred_by_code").eq("auth_uid", user.id).maybeSingle();
      if (!vivo || !c?.id) return;          // aun sin ficha: se reintenta luego

      if (!c.referred_by_code) {
        const { error } = await sb.rpc("set_referred_by", { p_code: pend });
        if (error) console.error("set_referred_by:", error.message);
      }
      try { window.localStorage.removeItem("kuve_ref"); } catch { /* da igual */ }
    })();
    return () => { vivo = false; };
  }, []);

  return null;
}
