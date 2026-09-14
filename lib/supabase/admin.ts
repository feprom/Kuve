import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente con SERVICE ROLE: salta RLS y puede crear usuarios de Auth.
// Solo desde routes de servidor (app/api/**). `import "server-only"` hace que
// el build FALLE si alguien lo importa desde un componente "use client".
//
// Las variables se leen al LLAMAR, no al importar: `next build` compila las
// routes sin las variables de servidor definidas y no debe romperse.
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    // Sin sesion persistente: es un cliente de servicio, no de un usuario.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
