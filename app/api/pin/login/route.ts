import { NextResponse } from "next/server";

import { PIN_BLOQUEO_MIN, PIN_MAX_FALLOS, passwordDePin } from "@/lib/pin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseRoute } from "@/lib/supabase/route";

// POST /api/pin/login  { email, pin }
//   400 { error }             email vacio o PIN sin seis digitos
//   423 { error, segundos }   email bloqueado (5 fallos -> 15 min); tambien en el 5o fallo
//   401 { error }             "Email o PIN incorrectos" (identico si el email no existe)
//   500 { error }             fallo de DB
//   200 { ok: true }          con las cookies de sesion puestas
//
// El contador vive en pin_attempts (solo service role). Se cuenta por EMAIL y
// no por IP porque el objetivo es frenar la fuerza bruta sobre un PIN de 6
// digitos, y el atacante puede cambiar de IP pero no de email.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { email?: unknown; pin?: unknown };
type Intento = { fails: number | null; locked_until: string | null };

const MENSAJE_FALLO = "Email o PIN incorrectos";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const email = String(body.email ?? "").trim().toLowerCase();
  const pin = String(body.pin ?? "");
  if (!email || !/^\d{6}$/.test(pin)) return NextResponse.json({ error: "Faltan el email o el PIN" }, { status: 400 });

  const admin = supabaseAdmin();
  const ahora = Date.now();

  // 1. Bloqueo vigente
  const { data: intento, error: leerErr } = await admin
    .from("pin_attempts")
    .select("fails,locked_until")
    .eq("email", email)
    .maybeSingle();
  if (leerErr) return NextResponse.json({ error: "No se pudo comprobar el acceso" }, { status: 500 });
  const fila = (intento ?? null) as Intento | null;
  const hasta = fila?.locked_until ? Date.parse(fila.locked_until) : 0;
  if (hasta > ahora) return bloqueado(hasta, ahora);

  // 2. Intento real contra Auth con la contrasena derivada (nunca el PIN)
  const sesion = supabaseRoute();
  const { data, error } = await sesion.auth.signInWithPassword({ email, password: passwordDePin(email, pin) });

  if (error || !data?.session) {
    // 3. Fallo: mismo mensaje exista o no el email. Si el bloqueo anterior ya
    //    vencio, fails vale 0 (se puso a 0 al bloquear).
    const fails = (fila?.fails ?? 0) + 1;
    const lastAt = new Date(ahora).toISOString();
    if (fails >= PIN_MAX_FALLOS) {
      const lockedUntil = ahora + PIN_BLOQUEO_MIN * 60_000;
      await admin.from("pin_attempts").upsert({ email, fails: 0, locked_until: new Date(lockedUntil).toISOString(), last_at: lastAt });
      return bloqueado(lockedUntil, ahora);
    }
    await admin.from("pin_attempts").upsert({ email, fails, locked_until: null, last_at: lastAt });
    return NextResponse.json({ error: MENSAJE_FALLO }, { status: 401 });
  }

  // 4. Exito: se olvida el historial de fallos
  await admin.from("pin_attempts").delete().eq("email", email);
  return NextResponse.json({ ok: true });
}

function bloqueado(hasta: number, ahora: number) {
  const segundos = Math.max(1, Math.ceil((hasta - ahora) / 1000));
  return NextResponse.json({ error: "Demasiados intentos; vuelve a probar mas tarde", segundos }, { status: 423 });
}
