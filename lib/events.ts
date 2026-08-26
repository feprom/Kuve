/** Traduccion de los eventos del bot (tabla events) a lenguaje de producto.
 *  El feed del cliente y el del admin comparten este mapa. */

export type EventRow = {
  id: number;
  ts: string;
  level: string | null;   // info | warn | error
  kind: string | null;
  detail: Record<string, unknown> | null;
};

const sym = (d: Record<string, unknown> | null) =>
  typeof d?.symbol === "string" ? (d.symbol as string).replace("USDT", "") : null;

/** Etiqueta corta en español para cada kind conocido; fallback al kind crudo. */
export function eventLabel(e: EventRow): string {
  const s = sym(e.detail);
  switch (e.kind) {
    case "position_adopted":         return s ? `Posición existente adoptada en ${s}` : "Posición existente adoptada";
    case "adopted_position_closed":  return s ? `Cerrada posición adoptada en ${s}` : "Cerrada posición adoptada";
    case "safety_sl_placed":         return s ? `Stop de seguridad colocado en ${s}` : "Stop de seguridad colocado";
    case "safety_sl_failed":         return s ? `Falló el stop de seguridad en ${s}` : "Falló el stop de seguridad";
    case "order_failed":             return s ? `Orden rechazada en ${s}` : "Orden rechazada";
    case "client_bar_failed":        return "Fallo al procesar la vela";
    case "below_min_equity":         return "Equity por debajo del mínimo operativo";
    case "drift_contradicts_signal": return s ? `Posición en ${s} contradice la señal` : "Posición contradice la señal";
    case "keys_stored":              return "Claves API guardadas";
    case "keys_invalid":             return "Claves API inválidas";
    case "admin_enabled":            return "Bot activado";
    case "admin_disabled":           return "Bot pausado";
    case "watchdog_alert":           return "Alerta del watchdog: el bot dejó de reportar";
    case "watchdog_recovered":       return "El bot volvió a reportar";
    default:                          return e.kind ?? "evento";
  }
}

/** Eventos de bajo nivel que se repiten cada hora: fuera del feed por defecto. */
export const KINDS_RUIDO = new Set(["safety_sl_placed", "position_adopted", "below_min_equity"]);

/** "hace 2 h", "ayer", "12/08" — para el feed. */
export function tsRelativo(iso: string, ahora: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const d = ahora - t;
  if (d < 3600e3) return `hace ${Math.max(1, Math.round(d / 60e3))} min`;
  if (d < 24 * 3600e3) return `hace ${Math.round(d / 3600e3)} h`;
  if (d < 48 * 3600e3) return "ayer";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}
