import { NextResponse } from "next/server";

import { passwordDePin, pinValido } from "@/lib/pin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseRoute } from "@/lib/supabase/route";

// POST /api/pin/set  { pin }   (requiere sesion en cookies)
//   401 { error }   sin sesion
//   400 { error }   PIN no valido
//   500 { error }   Auth o DB fallaron
//   200 { ok: true }
//
// Crea o cambia el PIN del cliente que ya tiene sesion. OJO: SUSTITUYE su
// contrasena de Auth por la derivada del PIN (la UI lo avisa en claro); a
// partir de ahi entra con email + PIN. set_pin_marker pone clients.pin_set_at
// con la sesion del propio usuario (RLS del propio cliente).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { pin?: unknown };

export async function POST(req: Request) {
  const sesion = supabaseRoute();
  const { data: { user } } = await sesion.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Sesion no valida" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const pin = String(body.pin ?? "");
  if (!pinValido(pin)) return NextResponse.json({ error: "PIN no valido: seis digitos, sin repetir ni secuencias" }, { status: 400 });

  const { error: authErr } = await supabaseAdmin().auth.admin.updateUserById(user.id, {
    password: passwordDePin(user.email, pin),
  });
  if (authErr) return NextResponse.json({ error: "No se pudo guardar el PIN" }, { status: 500 });

  const { error: rpcErr } = await sesion.rpc("set_pin_marker");
  if (rpcErr) return NextResponse.json({ error: "PIN guardado, pero no se pudo anotar en el perfil" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
