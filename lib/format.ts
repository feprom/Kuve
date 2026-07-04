export const fmtUsd = (v: number | null | undefined, dp = 2) =>
  v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export const pnlClass = (v: number | null | undefined) =>
  v == null ? "" : v >= 0 ? "pos" : "neg";

export const CHART_COLORS = ["#29a9e1", "#35c98e", "#e0b45d", "#e05d75",
  "#9b7ce0", "#5de0d2", "#e08a5d", "#7c9be0"];
