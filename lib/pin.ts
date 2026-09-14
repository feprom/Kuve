import { createHmac } from "node:crypto";

// Derivacion del PIN de 6 digitos a la contrasena real de Supabase Auth.
//
// POR QUE: un PIN de 6 digitos tiene solo 10^6 combinaciones; si fuera la
// contrasena tal cual, un volcado de auth.users se rompe en segundos. La
// contrasena que guarda Supabase es un HMAC del (email, pin) con un pepper que
// SOLO vive en las variables de entorno del servidor (Vercel): sin el pepper no
// se puede adivinar el PIN a partir del hash, y sin el hash el pepper no sirve.
// Cambiar el pepper invalida TODOS los PIN (documentado en el README).
//
// Solo se usa en routes de servidor (app/api/**). Nunca en codigo "use client".

export const PIN_MAX_FALLOS = 5;   // fallos seguidos por email antes de bloquear
export const PIN_BLOQUEO_MIN = 15; // minutos de bloqueo

// PIN prohibidos aparte de los seis digitos iguales: los que aparecen en todas
// las listas de "PIN mas usados".
const PIN_TRIVIALES = new Set(["123456", "654321", "000000", "123123", "112233", "123321"]);

export function pinValido(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false; // 000000, 111111, ...
  return !PIN_TRIVIALES.has(pin);
}

export function passwordDePin(email: string, pin: string, pepper = process.env.KUVE_PIN_PEPPER): string {
  if (!pepper) throw new Error("Falta KUVE_PIN_PEPPER en el entorno del servidor");
  // El email va en minusculas: Supabase Auth ya lo normaliza asi, y el cliente
  // puede teclearlo con mayusculas en el login sin que cambie la derivacion.
  return createHmac("sha256", pepper).update(`${email.trim().toLowerCase()}\n${pin}`).digest("base64url");
}

// Cliente invitado sin email: cuenta interna que nadie puede recuperar por
// correo (dominio .invalid, RFC 2606). La recuperacion es siempre re-invitacion.
export function emailInterno(clientId: string): string {
  return `${clientId}@clientes.kuve.invalid`;
}
