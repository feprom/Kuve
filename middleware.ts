import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas de INVITADO: se ven sin sesion, y a quien ya entro se le manda al
// dashboard.
const PUBLIC_PATHS = ["/login", "/register", "/forgot"];

// Rutas ABIERTAS: valen con sesion y sin ella, y el middleware no las toca.
// `/reset` TIENE que estar aqui y no en PUBLIC_PATHS: el enlace del correo de
// recuperacion ABRE SESION antes de llegar, asi que la regla "con sesion ->
// dashboard" rebotaria al cliente justo antes de dejarle escribir la contrasena
// nueva, y la recuperacion no funcionaria nunca.
const OPEN_PATHS = ["/reset"];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies: { name: string; value: string; options?: CookieOptions }[]) => {
          cookies.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookies.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const isPublic = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  // Los redirects deben LLEVAR las cookies que setAll acaba de refrescar: si se
  // pierden, el refresh token rotado se descarta y la sesión se cae al azar.
  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, req.url));
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  if (OPEN_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return res;
  if (!user && !isPublic) return redirect("/login");
  if (user && isPublic) return redirect("/dashboard");
  return res;
}

export const config = {
  // Excluye estáticos: sin esto cada imagen de /public dispara un getUser().
  // `webmanifest` está en la lista por una razón comprobada en producción: sin
  // él, /manifest.webmanifest respondía 307 a /login y el navegador no podía
  // leerlo, así que la app no se podía instalar en el móvil ni cogía sus iconos.
  matcher: ["/((?!_next|api|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|webmanifest)$).*)"],
};
