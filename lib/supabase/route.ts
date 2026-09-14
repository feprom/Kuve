import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente Supabase para route handlers (app/api/**) con la sesion del usuario
// en cookies: mismo patron getAll/setAll que middleware.ts. Un
// `signInWithPassword` con este cliente DEJA las cookies de sesion en la
// respuesta, que es lo que necesitan /api/pin/login y /api/invite/accept.
export function supabaseRoute() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Fuera de un route handler (p. ej. Server Component) `set` lanza;
            // ahi las cookies las refresca el middleware.
          }
        },
      },
    }
  );
}
