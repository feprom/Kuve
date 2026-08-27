/** Formateo canonico. Estas funciones son el ultimo cortafuegos: un NaN que
 *  llegue hasta aqui muere como "—", nunca se pinta "NaN" en rojo. */

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Guion "-" -> menos tipografico U+2212: mismo ancho que "+", no baila. */
const MENOS = "−";

export const fmtUsd = (v: number | null | undefined, dp = 2) =>
  !ok(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    .replace("-", MENOS);

export const fmtPct = (v: number | null | undefined, dp = 2) => {
  if (!ok(v)) return "—";
  const r = Number(v.toFixed(dp)); // evita "-0.00%" y "+" sobre cero negativo
  return `${r > 0 ? "+" : r < 0 ? MENOS : ""}${Math.abs(r).toFixed(dp)}%`;
};

/** Fecha corta en hora LOCAL del navegador (para el usuario final). */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/** Fecha corta en UTC con sufijo — para todo lo que sea vela/barra/fill del bot. */
export const fmtDateUtc = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      }) + " UTC"
    : "—";

/** Mes largo de una fecha-dia UTC ("2026-08-01" -> "agosto de 2026"), sin
 *  deslizarse al mes anterior en husos negativos. */
export const fmtMesUtc = (isoDia: string | null | undefined) =>
  isoDia
    ? new Date(isoDia + "T00:00:00Z").toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    : "—";

/** Verde/rojo SOLO significan ganancia/perdida. El cero es neutro: pintar
 *  "0.00" de verde afirmaria un resultado que no existe. */
export const pnlClass = (v: number | null | undefined, eps = 0.005) =>
  !ok(v) || Math.abs(v) < eps ? "" : v > 0 ? "pos" : "neg";

/**
 * Paleta categorica del donut/series por activo. Validada (2026-08-27) con el
 * validador de dataviz sobre el fondo #0b0e13: banda de luminosidad, croma,
 * separacion para daltonismo y contraste — TODO PASS. No incluye los verdes/
 * rojos semanticos (--green/--red quedan reservados para ganancia/perdida).
 * El orden es FIJO: los colores identifican, no se reciclan ni reordenan.
 */
export const CHART_COLORS = ["#3d95cc", "#c9822e", "#a07ce8", "#35a893",
  "#b28a20", "#d06a9e", "#7a8fd4", "#c9704a"];
