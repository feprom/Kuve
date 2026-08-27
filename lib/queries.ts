/**
 * Carga canonica de datos por cliente. UNA sola definicion de cada consulta,
 * con paginacion real: PostgREST corta en max-rows (1000 por defecto) aunque el
 * .limit() pida mas, y ya hay clientes con >1000 snapshots — sin esto la serie
 * pierde su inception en silencio y el TWR arranca tarde.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

/**
 * Trae TODAS las filas de una consulta paginando con .range(). `build` recibe
 * (from, to) y debe devolver la consulta ya ordenada (el orden es obligatorio:
 * sin ORDER BY el subconjunto de cada pagina seria no determinista).
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxPages = 30,
): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build(p * PAGE, (p + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Snapshots completos de un cliente, ascendentes por ts. */
export function fetchSnaps(sb: SupabaseClient, clientId: string) {
  return fetchAll<Record<string, unknown>>((from, to) =>
    sb.from("account_snapshots")
      .select("ts, bar_time, equity, wallet_balance, unrealized_pnl, realized_cum, start_equity, exposure_notional, margin_used, open_positions, dd_pct, n_trades")
      .eq("client_id", clientId)
      .order("ts", { ascending: true })
      .range(from, to),
  );
}

/** Ledger completo de un cliente desde una fecha, ascendente por ts. */
export function fetchIncome(sb: SupabaseClient, clientId: string, desdeTs?: string) {
  return fetchAll<Record<string, unknown>>((from, to) => {
    let q = sb.from("account_income")
      .select("income_type, income, ts, symbol")
      .eq("client_id", clientId)
      .order("ts", { ascending: true });
    if (desdeTs) q = q.gte("ts", desdeTs);
    return q.range(from, to);
  });
}

/** Trades de un cliente, descendentes (los mas nuevos primero). */
export function fetchTrades(sb: SupabaseClient, clientId: string, limitPages = 5) {
  return fetchAll<Record<string, unknown>>((from, to) =>
    sb.from("trades")
      .select("id, ts, bar_time, symbol, tag, side, profit, commission, cum, qty, price")
      .eq("client_id", clientId)
      .order("ts", { ascending: false })
      .range(from, to),
  limitPages);
}

/** Ordenes filled de un cliente, descendentes. */
export function fetchOrdersFilled(sb: SupabaseClient, clientId: string, limitPages = 5) {
  return fetchAll<Record<string, unknown>>((from, to) =>
    sb.from("orders")
      .select("id, ts, symbol, side, status, reduce_only, qty, executed_qty, avg_price")
      .eq("client_id", clientId)
      .eq("status", "filled")
      .order("ts", { ascending: false })
      .range(from, to),
  limitPages);
}

/** Eventos de un cliente, descendentes. */
export function fetchEvents(sb: SupabaseClient, clientId: string, max = 200) {
  return sb.from("events")
    .select("id, ts, level, kind, detail")
    .eq("client_id", clientId)
    .order("ts", { ascending: false })
    .limit(max);
}
