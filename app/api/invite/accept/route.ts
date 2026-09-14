import { NextResponse } from "next/server";

import { emailInterno, passwordDePin, pinValido } from "@/lib/pin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseRoute } from "@/lib/supabase/route";

// POST /api/invite/accept  { token, pin }
//   400 { error }           PIN o token mal formados
//   410 { error, estado }   invitacion usada | caducada | inexistente
//   409 { error }           invitacion NUEVA cuyo email ya tiene cuenta en Auth
//   500 { error }           fallo de DB / Auth (la invitacion sigue viva)
//   200 { ok: true, email } con las cookies de sesion puestas
//
// Dos caminos segun la fila de clients a la que apunta la invitacion:
//  - sin auth_uid (o cliente nuevo): crea el usuario de Auth con la contrasena
//    derivada del PIN (lib/pin.ts);
//  - con auth_uid: la re-invitacion ES la via de recuperacion del PIN, asi que
//    se SUSTITUYE la contrasena de ese usuario (updateUserById) sin crear nada.
// Despues consume la invitacion (accept_invite, solo service role) e inicia
// sesion.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { token?: unknown; pin?: unknown };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const token = String(body.token ?? "").trim().toUpperCase(); // alfabeto en mayusculas
  const pin = String(body.pin ?? "");
  if (!token) return NextResponse.json({ error: "Falta el token de la invitacion" }, { status: 400 });
  if (!pinValido(pin)) return NextResponse.json({ error: "PIN no valido: seis digitos, sin repetir ni secuencias" }, { status: 400 });

  // 1. Estado de la invitacion con el cliente anon: invite_peek esta pensada para el.
  const sesion = supabaseRoute();
  const { data: peek, error: peekErr } = await sesion.rpc("invite_peek", { p_token: token });
  if (peekErr) return NextResponse.json({ error: "No se pudo comprobar la invitacion" }, { status: 500 });
  const fila = Array.isArray(peek) ? peek[0] : peek;
  const estado = String(fila?.estado ?? "inexistente");
  if (estado !== "valida") return NextResponse.json({ error: "Esta invitacion ya no vale; pide un enlace nuevo", estado }, { status: 410 });

  // 2. Datos reales de la invitacion (email, client_id): invite_peek no los
  //    expone a proposito; el service role lee la tabla directamente.
  const admin = supabaseAdmin();
  const { data: inv, error: invErr } = await admin
    .from("client_invites")
    .select("client_id,email,name")
    .eq("token", token)
    .maybeSingle();
  if (invErr || !inv) return NextResponse.json({ error: "No se pudo leer la invitacion" }, { status: 500 });
  const clientId = (inv.client_id as string | null) ?? null;
  const emailInvitacion = (inv.email as string | null)?.trim().toLowerCase() || null;

  // 3. Si apunta a un cliente existente, ver si ya tiene usuario de Auth.
  let authUid: string | null = null;
  let emailCliente: string | null = null;
  if (clientId) {
    const { data: cli, error: cliErr } = await admin.from("clients").select("auth_uid,email").eq("id", clientId).maybeSingle();
    if (cliErr) return NextResponse.json({ error: "No se pudo leer el cliente" }, { status: 500 });
    authUid = (cli?.auth_uid as string | null) ?? null;
    emailCliente = (cli?.email as string | null)?.trim().toLowerCase() || null;
  }

  let email: string;
  let uid: string;

  if (authUid) {
    // 3a. Usuario existente: la contrasena se deriva del email con el que
    //     entrara, que es el de Auth (la fuente de verdad), y se sustituye.
    const { data: existente } = await admin.auth.admin.getUserById(authUid);
    email = existente?.user?.email?.trim().toLowerCase() || emailCliente || emailInvitacion || emailInterno(clientId!.toLowerCase());
    const { error: updErr } = await admin.auth.admin.updateUserById(authUid, { password: passwordDePin(email, pin) });
    if (updErr) return NextResponse.json({ error: "No se pudo restablecer el acceso" }, { status: 500 });
    uid = authUid;
  } else {
    // 3b. Sin usuario: alta. Sin email, cuenta interna con el id del cliente;
    //     si es cliente nuevo aun no hay id (lo crea el trigger), vale el token.
    email = emailInvitacion || emailInterno((clientId ?? token).toLowerCase());
    // email_confirm: el enlace de invitacion ya prueba la posesion; no hay
    // correo de confirmacion (ni podria, con email interno).
    const { data: creado, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: passwordDePin(email, pin),
      email_confirm: true,
      user_metadata: { name: inv.name },
    });
    if (createErr || !creado?.user) {
      const yaExiste = createErr?.code === "email_exists" || createErr?.status === 422 || /already|exists|registered/i.test(createErr?.message ?? "");
      if (yaExiste) {
        return NextResponse.json(
          { error: "Esta direccion ya tiene cuenta; entra con tu contrasena o pide al admin que te vuelva a invitar" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "No se pudo crear el acceso" }, { status: 500 });
    }
    uid = creado.user.id;
  }

  // 4. Consumir la invitacion y enlazar la fila de clients. Si falla y el
  //    usuario se acaba de crear, se borra para que el enlace se pueda
  //    reintentar; un usuario preexistente nunca se toca.
  const { error: accErr } = await admin.rpc("accept_invite", { p_token: token, p_auth_uid: uid, p_email: email });
  if (accErr) {
    if (!authUid) await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    return NextResponse.json({ error: "No se pudo activar la invitacion; vuelve a intentarlo" }, { status: 500 });
  }

  // 5. Sesion en cookies. Si fallara, la cuenta ya existe: el cliente entra
  //    con email + PIN desde /login.
  await sesion.auth.signInWithPassword({ email, password: passwordDePin(email, pin) });

  return NextResponse.json({ ok: true, email });
}
