/**
 * Carga canonica de datos por cliente. UNA sola definicion de cada consulta,
 * con paginacion real: PostgREST corta en max-rows (1000 por defecto) aunque el
 * .limit() pida mas, y ya hay clientes con >1000 snapshots — sin esto la serie
 * pierde su inception en silencio y el TWR arranca tarde.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENT_KINDS_ATRIBUCION, EVENT_KIND_STOP_LIKE } from "./metrics";

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

/**
 * Posiciones de la ULTIMA vela de un cliente. Dos viajes cortos (la vela mas
 * reciente, y las filas de esa vela) en lugar de un barrido por ventana: un
 * `.gte("bar_time", ahora-26h)` global reparte el corte de max-rows entre todos
 * los clientes y, ordenado ascendente, devuelve las filas MAS VIEJAS —
 * /admin ya truncaba en silencio con 5 clientes (1.080 filas contra el corte
 * de 1.000) y mostraba exposicion y uPnL de dos velas atras.
 *
 * Devuelve las filas crudas SIN deduplicar ni filtrar ceros: `positions` no
 * tiene unique de negocio y el reproceso de una vela deja duplicados, asi que
 * quien consume decide (la fila de `id` mayor gana, y los cierres con
 * pos_amt=0 solo se descartan DESPUES de deduplicar).
 */
export async function fetchPositionsLatest(sb: SupabaseClient, clientId: string) {
  const { data: ult, error: e1 } = await sb.from("positions")
    .select("bar_time").eq("client_id", clientId)
    .order("bar_time", { ascending: false }).limit(1);
  if (e1) throw new Error(e1.message);
  const barTime = ult?.[0]?.bar_time as string | undefined;
  if (!barTime) return [];
  return fetchAll<Record<string, unknown>>((from, to) =>
    sb.from("positions")
      .select("id, client_id, bar_time, symbol, side, pos_amt, entry_price, price")
      .eq("client_id", clientId)
      .eq("bar_time", barTime)
      .order("id", { ascending: true })
      .range(from, to),
  2);
}

/**
 * Compensaciones reconocidas por Kuve y aun NO liquidadas.
 *
 * QUE SON: un DERECHO DE COBRO, no equity. Kuve reconoce una perdida causada por
 * un defecto suyo y se compromete a saldarla en la liquidacion de fin de anio.
 * Mientras no se transfiera, ese dinero NO esta en Binance.
 *
 * POR QUE LA APP LAS NECESITA: el informe mensual y la tarjeta diaria publican
 * "saldo Binance + saldo Kuve = total". La app solo mostraba el equity de
 * Binance, asi que el mismo cliente veia dos saldos distintos el mismo dia — en
 * Denise, 4.422,61 en pantalla contra 4.767,98 en el PDF: un 7,8 % de diferencia
 * sin ninguna explicacion. Los cinco clientes estaban afectados.
 *
 * NUNCA sumar esto dentro del equity: el extracto de Binance prevalece y tiene
 * que seguir cuadrando con lo que la app llama "Equity". Va en su propia linea.
 *
 * RLS: `ccomp_select_own` / `ccomp_admin_all` — el cliente ve solo lo suyo.
 */
export function fetchCompensaciones(sb: SupabaseClient, clientId: string) {
  return sb.from("client_compensations")
    .select("id, fecha, monto_usd, concepto, estado")
    .eq("client_id", clientId)
    .eq("estado", "pendiente")
    .order("fecha", { ascending: true });
}

/**
 * Eventos que necesita la ATRIBUCION POR ACTIVO, desde el inception y sin corte
 * de filas.
 *
 * POR QUE NO SIRVE `fetchEvents`: esa trae los N mas recientes (60, 150, 200)
 * para el feed. `clasificar` tiene que ver TODOS los eventos de la vida de la
 * cuenta — si le falta el `drift_contradicts_signal` de julio, ese cierre pasa
 * de «incidencia tecnica asumida por Kuve» a «operacion de la estrategia» y la
 * pantalla publica un resultado por activo distinto del que imprime el PDF.
 *
 * POR QUE SE FILTRA POR `kind`: `clasificar` solo mira cuatro tipos, y son
 * exactamente los de `EVENT_KINDS_ATRIBUCION` + `EVENT_KIND_STOP_LIKE`. Traer
 * el resto seria bajar miles de filas al navegador para descartarlas. El motor
 * de informes no filtra (en SQL directo no cuesta nada); el resultado de la
 * clasificacion es identico, y la sonda probe_app_vs_informe_activos.ts lo
 * comprueba corriendo las dos entradas contra el mismo `clasificar`.
 */
export function fetchEventosAtribucion(sb: SupabaseClient, clientId: string, desdeTs: string) {
  const enLista = EVENT_KINDS_ATRIBUCION.join(",");
  return fetchAll<Record<string, unknown>>((from, to) =>
    sb.from("events")
      .select("ts, kind, detail")
      .eq("client_id", clientId)
      .gte("ts", desdeTs)
      .or(`kind.in.(${enLista}),kind.like.*${EVENT_KIND_STOP_LIKE}*`)
      .order("ts", { ascending: true })
      .range(from, to));
}

/**
 * TODAS las compensaciones vivas del cliente — las mismas filas que ve el
 * informe (`reportes/lib/db.ts::compensaciones`): `tipo = 'compensacion'` y
 * `estado <> 'anulado'`.
 *
 * NO confundir con `fetchCompensaciones`, que filtra `estado = 'pendiente'`
 * porque su pregunta es otra ("cuanto le debe Kuve HOY"). Para el reparto por
 * activo hace falta tambien lo ya LIQUIDADO: una reparacion que se pago sigue
 * explicando el resultado del activo al que se imputo. Con el filtro de
 * pendientes, el dia que se liquide la compensacion la app dejaria de repartirla
 * y el PDF seguiria haciendolo — dos tablas distintas del mismo cuadro.
 */
export function fetchCompensacionesVivas(sb: SupabaseClient, clientId: string) {
  return sb.from("client_compensations")
    .select("id, fecha, monto_usd, concepto, estado, tipo")
    .eq("client_id", clientId)
    .eq("tipo", "compensacion")
    .neq("estado", "anulado")
    .order("fecha", { ascending: true });
}
