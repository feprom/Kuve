/** Formateo canonico. Estas funciones son el ultimo cortafuegos: un NaN que
 *  llegue hasta aqui muere como "—", nunca se pinta "NaN" en rojo. */

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const fmtUsd = (v: number | null | undefined, dp = 2) =>
  !ok(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtPct = (v: number | null | undefined, dp = 2) => {
  if (!ok(v)) return "—";
  const r = Number(v.toFixed(dp)); // evita "-0.00%" y "+" sobre cero negativo
  return `${r > 0 ? "+" : ""}${r.toFixed(dp)}%`;
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

export const pnlClass = (v: number | null | undefined) =>
  !ok(v) ? "" : v >= 0 ? "pos" : "neg";

export const CHART_COLORS = ["#29a9e1", "#35c98e", "#e0b45d", "#e05d75",
  "#9b7ce0", "#5de0d2", "#e08a5d", "#7c9be0"];
