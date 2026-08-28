import { AuthError } from "@supabase/supabase-js";

function extraerNumero(texto: string): number | null {
  const match = texto.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Traduce a español claro los errores más frecuentes de Supabase Auth.
 * Acepta Error, AuthError, string, objetos tipo AuthError o null.
 */
export function mensajeAuth(e: unknown): string {
  let mensaje = "";
  let code = "";
  let status: number | undefined;

  if (typeof e === "string") {
    mensaje = e;
  } else if (e instanceof AuthError) {
    mensaje = e.message;
    code = e.code ?? "";
    status = e.status;
  } else if (e instanceof Error) {
    mensaje = e.message;
  } else if (e !== null && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") mensaje = obj.message;
    if (typeof obj.code === "string") code = obj.code;
    if (typeof obj.status === "number") status = obj.status;
  }

  if (!mensaje && !code) {
    return "Ha ocurrido un error inesperado. Inténtalo de nuevo.";
  }

  const m = mensaje.toLowerCase();
  const numero = extraerNumero(mensaje);

  // Códigos concretos de Supabase Auth
  if (code === "invalid_credentials") {
    return "El email o la contraseña no son correctos.";
  }
  if (code === "email_not_confirmed") {
    return "Todavía no has confirmado el email. Revisa tu bandeja de entrada.";
  }
  if (code === "user_already_exists" || code === "user_already_registered") {
    return "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña.";
  }
  if (code === "weak_password") {
    return numero !== null
      ? `La contraseña debe tener al menos ${numero} caracteres.`
      : "La contraseña no es válida. Asegúrate de que cumple los requisitos.";
  }
  if (code === "same_password") {
    return "La contraseña nueva debe ser distinta de la actual.";
  }
  if (code === "session_not_found") {
    return "No hay una sesión activa. Inicia sesión de nuevo.";
  }
  if (
    code === "bad_code_verifier" ||
    code === "verification_failed" ||
    code === "token_expired" ||
    code === "token_has_expired"
  ) {
    return "El enlace no es válido o ha caducado. Solicita uno nuevo.";
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return "No se ha podido validar el email. Comprueba que esté bien escrito.";
  }
  if (code === "network_request_failed") {
    return "No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
  }

  // Textos que devuelve Supabase en inglés
  if (m.includes("invalid login credentials")) {
    return "El email o la contraseña no son correctos.";
  }
  if (m.includes("email not confirmed")) {
    return "Todavía no has confirmado el email. Revisa tu bandeja de entrada.";
  }
  if (m.includes("user already registered")) {
    return "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña.";
  }
  if (m.includes("password should be at least")) {
    return numero !== null
      ? `La contraseña debe tener al menos ${numero} caracteres.`
      : "La contraseña debe tener una longitud mínima.";
  }
  if (m.includes("email rate limit exceeded") || code === "over_email_send_rate_limit") {
    return numero !== null
      ? `Has pedido demasiados correos seguidos. Prueba en ${numero} segundos.`
      : "Has pedido demasiados correos seguidos. Espera un poco.";
  }
  if (m.includes("for security purposes")) {
    return numero !== null
      ? `Has pedido demasiados correos seguidos. Prueba en ${numero} segundos.`
      : "Has pedido demasiados correos seguidos. Espera un poco.";
  }
  if (m.includes("new password should be different")) {
    return "La contraseña nueva debe ser distinta de la actual.";
  }
  if (m.includes("auth session missing")) {
    return "No hay una sesión activa. Inicia sesión de nuevo.";
  }
  if (
    m.includes("token has expired") ||
    m.includes("token is invalid") ||
    m.includes("invalid or expired")
  ) {
    return "El enlace no es válido o ha caducado. Solicita uno nuevo.";
  }
  if (m.includes("unable to validate email address")) {
    return "No se ha podido validar el email. Comprueba que esté bien escrito.";
  }
  // Deliberadamente el MISMO mensaje que credenciales invalidas. Decir "no hay
  // ninguna cuenta con ese email" convierte la pantalla de acceso en un oraculo
  // que confirma que direcciones son clientes de una gestora. No compensa.
  if (m.includes("user not found")) {
    return "El email o la contraseña no son correctos.";
  }
  if (m.includes("signup requires a valid password")) {
    return "La contraseña no es válida. Asegúrate de que cumple los requisitos.";
  }
  if (m.includes("network request failed")) {
    return "No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
  }

  if (status === 429 || m.includes("rate limit")) {
    return numero !== null
      ? `Has hecho demasiadas peticiones. Prueba en ${numero} segundos.`
      : "Has hecho demasiadas peticiones. Espera un poco e inténtalo de nuevo.";
  }

  return "Ha ocurrido un error inesperado. Inténtalo de nuevo.";
}