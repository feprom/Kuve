/**
 * METRICAS CANONICAS DE KUVE — un solo lugar que calcula cada numero.
 *
 * Regla: ninguna pantalla reimplementa un retorno, un drawdown ni una
 * comparacion contra el benchmark. Todas consumen estas funciones. Antes de
 * este modulo, /dashboard, /performance y /admin calculaban lo suyo por
 * separado y divergian (ver md/AUDITORIA_resultados_app_2026-08-12.md, A1).
 *
 * El problema que resuelve (A1): el retorno "ingenuo" equity_hoy/equity_inicial
 * es FALSO en cuanto hay un deposito o un retiro. Caso real verificado:
 * Roberto Mendizabal daba +45,65% con esa formula; su retorno real es -5,22%.
 * La diferencia era un deposito de 1.293,04 USD el 2026-07-23.
 *
 * La respuesta correcta es el retorno TIME-WEIGHTED (TWR): se corta la serie en
 * cada movimiento de capital, se calcula el retorno de cada tramo y se encadenan.
 * Asi el numero mide la gestion del bot, no cuanta plata metio el cliente.
 *
 * Modulo puro: sin imports, sin acceso a red. Se puede correr en Node para
 * verificarlo contra datos reales (ops/kuve_dump_metrics.py + bin/verify_metrics.mjs).
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Fila de account_snapshots. Solo se exigen los campos que se usan. */
export type SnapLike = {
  ts: string;
  equity: number;
  unrealized_pnl?: number | null;
  realized_cum?: number | null;
  start_equity?: number | null;
};

/** Fila de account_income (el ledger real de Binance). */
export type IncomeLike = { income_type: string; income: number; ts: string };

/** Movimiento de capital: deposito (+) o retiro (-). */
export type Flujo = {
  t: number;           // ms epoch
  usd: number;         // + entra capital, - sale
  fuente: "ledger" | "salto";
};

/** Fila de strategy_benchmark. */
export type BenchLike = { date: string; equity_index: number };

export type Punto = { x: number; y: number };

/** Cierre de una posicion previa al bot (lib/pnl.ts -> heredadoFills). */
export type HeredadoFill = { ts: string; usd: number };

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** income_type que son operativa del bot, NO movimientos de capital. */
export const TIPOS_OPERATIVOS = ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE", "INSURANCE_CLEAR"];

/**
 * income_type que SI son movimientos de capital (lista blanca). Binance emite
 * ademas rebates (REFERRAL_KICKBACK, COMMISSION_REBATE, API_REBATE...) y swaps
 * internos (AUTO_EXCHANGE, COIN_SWAP_*): son ingreso operativo o neutro, no un
 * deposito del cliente — tratarlos como capital descontaria rendimiento real.
 */
export const TIPOS_CAPITAL = ["TRANSFER", "INTERNAL_TRANSFER", "WITHDRAW", "CROSS_COLLATERAL_TRANSFER"];

/**
 * Inception: la cuenta "existe" desde la primera barra con equity > EQUITY_MIN.
 * El deposito que FUNDA la cuenta NO es un flujo: si se tratara como tal, el
 * tramo (equity - flujo)/eq_prev tiende a 0 y el TWR sale -100%.
 */
export const EQUITY_MIN = 1;

/**
 * Umbral del detector por salto de equity: 5% del equity de la barra anterior.
 * Se aplica sobre el RESIDUAL (variacion de equity que no explican ni el uPnL ni
 * el realizado), no sobre la variacion bruta. Medido contra los 3.785 snapshots
 * de produccion, el peor residual legitimo es 0,77% — el margen es de 6x.
 */
export const UMBRAL_SALTO = 0.05;

const ms = (s: string) => new Date(s).getTime();
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

// ---------------------------------------------------------------------------
// 0. Saneo de la serie de snapshots
// ---------------------------------------------------------------------------

/**
 * Prepara la serie de snapshots para calcular sobre ella:
 *  1. descarta barras con equity no finito o negativo (fallos de API);
 *  2. deduplica por ts — la DB tiene filas duplicadas por (client_id, bar_time)
 *     tras recuperaciones del watchdog (verificado 2026-08-26) — quedandose con
 *     la ultima insertada;
 *  3. recorta el preludio sin fondear: la serie arranca en la primera barra con
 *     equity > EQUITY_MIN (regla de inception).
 *
 * TODA funcion de este modulo asume entrada saneada; las pantallas deben llamar
 * a esta funcion una sola vez al cargar.
 */
export function sanearSnaps<T extends SnapLike>(snaps: T[]): T[] {
  const porTs = new Map<string, T>();
  for (const s of snaps) {
    const eq = Number(s.equity);
    if (!Number.isFinite(eq) || eq < 0) continue;
    porTs.set(s.ts, s); // la ultima fila con el mismo ts manda
  }
  const ok = Array.from(porTs.values()).sort((a, b) => a.ts.localeCompare(b.ts));
  const i0 = ok.findIndex((s) => num(s.equity) > EQUITY_MIN);
  return i0 < 0 ? [] : ok.slice(i0);
}

/** Instante de inception: primera barra saneada (equity > EQUITY_MIN), o null. */
export function inceptionTs(snaps: SnapLike[]): number | null {
  const s = sanearSnaps(snaps);
  return s.length ? ms(s[0].ts) : null;
}

/** Variante de señales del perfil: risk_profiles.atr_mult NULL -> default. */
export const variantOf = (atrMult: number | string | null | undefined): string =>
  atrMult == null ? "default" : `atr${Math.round(Number(atrMult))}`;

// ---------------------------------------------------------------------------
// 1. Movimientos de capital
// ---------------------------------------------------------------------------

/**
 * Detecta depositos y retiros dentro de la ventana de snapshots, por las DOS
 * vias — ninguna sola alcanza:
 *
 *  - LEDGER (`account_income` con income_type fuera de los operativos). Es la
 *    fuente exacta: da el monto real y la hora real. Depende de que el sync de
 *    income este corriendo (timer kuve-income en el EC2).
 *  - SALTO de equity: residual = dEquity - dUnrealized - dRealized. Si supera
 *    el umbral, hubo movimiento aunque el ledger no lo haya visto todavia. Es
 *    la via que detecto el deposito de Roberto cuando el ledger estaba congelado.
 *
 * Solo cuentan los movimientos DENTRO de la ventana (t0, tN]: lo anterior al
 * primer snapshot ya esta dentro del capital inicial (caso Mario, cuyo TRANSFER
 * de alta ocurrio 58 min antes de su primer snapshot).
 */
export function detectarFlujos(
  snaps: SnapLike[],
  ledger: IncomeLike[] = [],
  opts: { umbral?: number } = {},
): Flujo[] {
  const s = sanearSnaps(snaps);
  if (s.length < 2) return [];
  const umbral = opts.umbral ?? UMBRAL_SALTO;
  const t = s.map((x) => ms(x.ts));
  const t0 = t[0], tN = t[t.length - 1];

  // --- via 1: ledger (lista BLANCA de tipos de capital, deduplicado) ---
  const vistos = new Set<string>();
  const delLedger: Flujo[] = [];
  for (const r of ledger) {
    if (TIPOS_OPERATIVOS.includes(r.income_type)) continue;
    if (!TIPOS_CAPITAL.includes(r.income_type)) {
      // tipo desconocido: NO es capital por defecto — avisar y seguir
      if (typeof console !== "undefined") console.warn("[metrics] income_type no clasificado:", r.income_type);
      continue;
    }
    const clave = `${r.ts}|${r.income_type}|${r.income}`;
    if (vistos.has(clave)) continue; // sync duplicado
    vistos.add(clave);
    const f = { t: ms(r.ts), usd: num(r.income), fuente: "ledger" as const };
    // sin tope superior: los flujos posteriores a la ultima vela hacen falta
    // para neutralizar el tramo "en vivo" (factorVivo)
    if (f.usd !== 0 && f.t > t0) delLedger.push(f);
  }

  // --- via 2: saltos de equity no explicados, barra a barra ---
  const flujos: Flujo[] = [];
  for (let i = 1; i < s.length; i++) {
    const enBarra = delLedger.filter((f) => f.t > t[i - 1] && f.t <= t[i]);
    const ledgerBarra = enBarra.reduce((a, f) => a + f.usd, 0);
    flujos.push(...enBarra);

    const eq0 = num(s[i - 1].equity);
    const eq1 = num(s[i].equity);
    if (eq0 <= EQUITY_MIN) continue; // sin base: no hay salto medible (tras saneo no deberia pasar)

    const dEq = eq1 - eq0;
    const dU = num(s[i].unrealized_pnl) - num(s[i - 1].unrealized_pnl);
    let dR = num(s[i].realized_cum) - num(s[i - 1].realized_cum);
    // realized_cum reseteado (bot reiniciado sin estado): un dR ~ -cum_anterior
    // inventaria un retiro fantasma por el realizado acumulado entero
    const cumPrev = num(s[i - 1].realized_cum);
    if (dR < 0 && cumPrev > 0 && Math.abs(dR + cumPrev) < 0.01 * Math.max(1, cumPrev)) dR = 0;

    // el ledger de la barra ya explica su parte: solo cuenta el residual RESTANTE
    const residual = dEq - dU - dR - ledgerBarra;
    if (Math.abs(residual) > umbral * Math.abs(eq0)) {
      flujos.push({ t: t[i], usd: residual, fuente: "salto" });
    }
  }

  // flujos del ledger posteriores a la ultima vela (para el tramo en vivo)
  flujos.push(...delLedger.filter((f) => f.t > tN));

  // Un deposito no revierte; el mark-to-market de una posicion heredada fuera
  // del universo (que mueve equity pero no unrealized_pnl) si. Dos saltos de
  // signo opuesto y magnitud similar a pocas barras de distancia se anulan.
  const saltos = flujos.filter((f) => f.fuente === "salto");
  const anulados = new Set<Flujo>();
  for (let i = 0; i < saltos.length; i++) {
    if (anulados.has(saltos[i])) continue;
    for (let j = i + 1; j < saltos.length; j++) {
      if (anulados.has(saltos[j])) continue;
      if (saltos[j].t - saltos[i].t > 6 * 3600e3) break;
      const a = saltos[i].usd, b = saltos[j].usd;
      if (a * b < 0 && Math.abs(a + b) < 0.25 * Math.max(Math.abs(a), Math.abs(b))) {
        anulados.add(saltos[i]); anulados.add(saltos[j]);
        break;
      }
    }
  }
  return flujos.filter((f) => !anulados.has(f)).sort((a, b) => a.t - b.t);
}

/** Suma de los flujos ocurridos en (desde, hasta]. */
export function flujosEntre(flujos: Flujo[], desde: number, hasta: number): number {
  return flujos.reduce((a, f) => a + (f.t > desde && f.t <= hasta ? f.usd : 0), 0);
}

/** Capital inicial de la cuenta: start_equity del bot, con respaldos. */
export function capitalInicial(snaps: SnapLike[]): number {
  const s = sanearSnaps(snaps);
  for (const x of s) { const v = num(x.start_equity); if (v) return v; }
  return num(s[0]?.equity);
}

/**
 * Capital aportado hasta t: inicial + depositos - retiros. Es la base contra la
 * que se mide el PnL en USD (y la que evita contar un deposito como ganancia).
 */
export function capitalAportado(snaps: SnapLike[], flujos: Flujo[], t: number): number {
  return capitalInicial(snaps) + flujos.reduce((a, f) => a + (f.t <= t ? f.usd : 0), 0);
}

// ---------------------------------------------------------------------------
// 2. PnL en USD y retorno time-weighted
// ---------------------------------------------------------------------------

/**
 * Serie del PnL del bot en USD, barra a barra:
 *
 *   pnl(t) = equity(t) - capital aportado(t) - cierres heredados(t)
 *
 * "Heredado" = cierres de posiciones que ya estaban abiertas antes de que el bot
 * tomara la cuenta (lib/pnl.ts los separa): entran al equity pero no son merito
 * del bot. Es la MISMA serie de la que salen el numero grande, la curva y el
 * drawdown — por eso los tres siempre cuadran entre si.
 */
export function seriePnl(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[] = [],
): { x: number; pnl: number; base: number }[] {
  const limpios = sanearSnaps(snaps);
  const inicial = capitalInicial(limpios);
  const hf = heredadoFills.map((h) => ({ t: ms(h.ts), usd: num(h.usd) })).sort((a, b) => a.t - b.t);
  return limpios.map((s) => {
    const x = ms(s.ts);
    const base = inicial + flujos.reduce((a, f) => a + (f.t <= x ? f.usd : 0), 0);
    const her = hf.reduce((a, h) => a + (h.t <= x ? h.usd : 0), 0);
    return { x, pnl: num(s.equity) - base - her, base };
  });
}

/**
 * Curva de valor time-weighted: indice base 1 al inicio de la serie, que crece o
 * cae SOLO por la gestion. Cada barra aporta su retorno con el capital que
 * entro o salio ya neutralizado:
 *
 *   r_barra = (equity_t - flujo_barra - heredado_barra) / equity_(t-1) - 1
 *
 * Las barras con equity previo 0 (cuenta aun sin fondear) no aportan retorno.
 */
export function curvaTwr(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[] = [],
): Punto[] {
  const s = sanearSnaps(snaps);
  if (!s.length) return [];
  const t = s.map((x) => ms(x.ts));
  const hf = heredadoFills.map((h) => ({ t: ms(h.ts), usd: num(h.usd) }));
  let factor = 1;
  const out: Punto[] = [{ x: t[0], y: 1 }];
  for (let i = 1; i < s.length; i++) {
    const eq0 = num(s[i - 1].equity);
    const f = flujosEntre(flujos, t[i - 1], t[i]);
    const h = hf.reduce((a, x) => a + (x.t > t[i - 1] && x.t <= t[i] ? x.usd : 0), 0);
    if (eq0 > EQUITY_MIN) {
      const r = (num(s[i].equity) - f - h) / eq0;
      // un ratio <= 0 solo puede salir de datos rotos o de un flujo mal fechado;
      // jamas de un retorno real — no se deja invertir ni anular la curva entera
      if (Number.isFinite(r) && r > 0) factor *= r;
    }
    out.push({ x: t[i], y: factor });
  }
  return out;
}

/** La misma curva expresada en % acumulado (0% al inicio) — lista para graficar. */
export function curvaTwrPct(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[] = [],
): Punto[] {
  return curvaTwr(snaps, flujos, heredadoFills).map((p) => ({ x: p.x, y: (p.y - 1) * 100 }));
}

/**
 * Retorno time-weighted acumulado, en %. ESTE es el numero que se le muestra al
 * cliente — nunca `equity/equity_inicial - 1`.
 */
export function twr(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[] = [],
): number | null {
  const c = curvaTwr(snaps, flujos, heredadoFills);
  if (c.length < 2) return null;
  return (c[c.length - 1].y - 1) * 100;
}

/**
 * Encadena al TWR de la serie un tramo final "en vivo" (los precios de Binance
 * cada 15 s mueven el equity entre velas). `equityVivo` es el equity de ahora.
 */
export function twrConVivo(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[],
  equityVivo: number | null | undefined,
  ahora: number = Date.now(),
): number | null {
  const f = factorVivo(snaps, flujos, heredadoFills, equityVivo, ahora);
  return f == null ? null : (f - 1) * 100;
}

/**
 * Factor TWR con el tramo en vivo encadenado — la version "indice" de
 * `twrConVivo`, para drawdown y graficos. Neutraliza los flujos de capital
 * ocurridos entre la ultima vela y ahora: un deposito de hace 20 minutos no es
 * retorno del bot.
 */
export function factorVivo(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[],
  equityVivo: number | null | undefined,
  ahora: number = Date.now(),
): number | null {
  const s = sanearSnaps(snaps);
  const c = curvaTwr(s, flujos, heredadoFills);
  if (c.length < 2) return null;
  const tUlt = ms(s[s.length - 1].ts);
  const eqUlt = num(s[s.length - 1].equity);
  let f = c[c.length - 1].y;
  if (equityVivo != null && eqUlt > EQUITY_MIN) {
    const flujoIntra = flujosEntre(flujos, tUlt, ahora);
    const r = (num(equityVivo) - flujoIntra) / eqUlt;
    if (Number.isFinite(r) && r > 0) f *= r;
  }
  return f;
}

// ---------------------------------------------------------------------------
// 3. Drawdown
// ---------------------------------------------------------------------------

/**
 * Maxima caida desde el pico de una curva de VALOR (equity, o el indice del TWR).
 * Devuelve un % negativo o 0. Sobre la curva TWR el drawdown queda tambien
 * limpio de depositos: un deposito ya no infla el pico.
 */
export function maxDrawdown(valores: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const v of valores) {
    if (!isFinite(v)) continue;
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.min(dd, (v / peak - 1) * 100);
  }
  return dd;
}

/**
 * Rendimiento time-weighted ENTRE dos instantes, sobre una curva ya calculada.
 * Sirve para periodos (un mes, una semana) sin recalcular nada: el indice es
 * multiplicativo, asi que el tramo es el cociente de sus extremos.
 */
export function twrEntre(curva: Punto[], desde: number, hasta: number): number | null {
  let v0: number | null = null, v1: number | null = null;
  for (const p of curva) {
    if (p.x <= desde) v0 = p.y;
    if (p.x <= hasta) v1 = p.y;
  }
  if (v0 == null) {
    // el periodo empieza antes que la cuenta: se arranca en su primera vela
    const dentro = curva.filter((p) => p.x >= desde && p.x <= hasta);
    if (dentro.length < 2) return null;
    v0 = dentro[0].y;
  }
  if (v1 == null || !v0) return null;
  return (v1 / v0 - 1) * 100;
}

/** Trozo de una curva dentro de una ventana (para drawdown por periodo). */
export function trozo(curva: Punto[], desde: number, hasta: number): Punto[] {
  return curva.filter((p) => p.x >= desde && p.x <= hasta);
}

/**
 * PnL en USD generado ENTRE dos instantes: diferencia de la serie de PnL, que ya
 * tiene descontados el capital aportado y los cierres heredados.
 */
export function pnlEntre(
  serie: { x: number; pnl: number }[],
  desde: number,
  hasta: number,
): number | null {
  let a: number | null = null, b: number | null = null;
  for (const p of serie) {
    if (p.x <= desde) a = p.pnl;
    if (p.x <= hasta) b = p.pnl;
  }
  if (a == null) {
    const dentro = serie.filter((p) => p.x >= desde && p.x <= hasta);
    if (dentro.length < 2) return null;
    a = dentro[0].pnl;
  }
  return b == null ? null : b - a;
}

/**
 * Serie de drawdown corriente (% desde el pico) de una curva de valor.
 * Con el mismo guard de finitud que maxDrawdown: un NaN no envenena el pico.
 */
export function serieDrawdown(curva: Punto[]): Punto[] {
  let pico = -Infinity;
  const out: Punto[] = [];
  for (const p of curva) {
    if (!isFinite(p.y)) continue;
    pico = Math.max(pico, p.y);
    out.push({ x: p.x, y: pico > 0 ? (p.y / pico - 1) * 100 : 0 });
  }
  return out;
}

/**
 * Drawdown maximo DENTRO de una ventana, sembrando el pico con el valor vigente
 * en `desde` (una caida que arranca al final del periodo anterior cuenta).
 */
export function maxDrawdownEntre(curva: Punto[], desde: number, hasta: number): number {
  let semilla: number | null = null;
  for (const p of curva) { if (p.x <= desde) semilla = p.y; else break; }
  const vals = curva.filter((p) => p.x >= desde && p.x <= hasta).map((p) => p.y);
  if (semilla != null) vals.unshift(semilla);
  return maxDrawdown(vals);
}

/** Atajo: drawdown maximo sobre la curva time-weighted de la cuenta. */
export function maxDrawdownTwr(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[] = [],
  factorVivo?: number | null,
): number {
  const c = curvaTwr(snaps, flujos, heredadoFills);
  const vals = c.map((p) => p.y);
  if (factorVivo != null && isFinite(factorVivo)) vals.push(factorVivo);
  return maxDrawdown(vals);
}

// ---------------------------------------------------------------------------
// 4. Benchmark
// ---------------------------------------------------------------------------

/** El indice tiene un punto por dia (fecha UTC). */
const benchTs = (b: BenchLike) => Date.parse(b.date + "T00:00:00Z");

/** Valor del indice vigente en `t` (el ultimo punto con fecha <= t). */
export function benchmarkEn(bench: BenchLike[], t: number): number | null {
  let v: number | null = null;
  for (const b of bench) { if (benchTs(b) <= t) v = num(b.equity_index); else break; }
  return v;
}

/**
 * Retorno del benchmark EN LA MISMA VENTANA que el cliente. `strategy_benchmark`
 * es un indice base 100 al 1 de enero; comparar el retorno de un cliente que
 * entro en julio contra el indice desde enero es un error de decenas de puntos
 * (KV-2: +17,7% YTD contra -3,46% en la ventana real). Ver A2 de la auditoria.
 */
export function benchmarkEnVentana(
  bench: BenchLike[],
  desde: number,
  hasta: number = Date.now(),
): number | null {
  if (!bench.length) return null;
  const orden = [...bench].sort((a, b) => benchTs(a) - benchTs(b));
  const v0 = benchmarkEn(orden, desde);
  const v1 = benchmarkEn(orden, hasta);
  if (!v0 || v1 == null) return null;
  return (v1 / v0 - 1) * 100;
}

/**
 * Serie del benchmark rebaseada a 0% en `desde`, lista para graficar.
 * El ultimo punto (hoy, parcial) se dibuja en la hora actual y no a las 00:00:
 * el bot reescribe la fila de hoy en cada vela.
 */
export function serieBenchmark(bench: BenchLike[], desde: number, ahora: number = Date.now()): Punto[] {
  if (!bench.length) return [];
  const orden = [...bench].sort((a, b) => benchTs(a) - benchTs(b));
  const base = benchmarkEn(orden, desde);
  if (!base) return [];
  return orden
    .filter((b) => benchTs(b) >= desde - 86400e3)
    .map((b, i, arr) => {
      let x = benchTs(b);
      if (i === arr.length - 1 && ahora - x > 0 && ahora - x < 86400e3) x = ahora;
      return { x, y: (num(b.equity_index) / base - 1) * 100 };
    });
}

// ---------------------------------------------------------------------------
// 5. Tiempo y alineacion
// ---------------------------------------------------------------------------

/**
 * Ultima vela horaria CERRADA. El bot evalua a HH:00:45 sobre la vela que cerro
 * a HH:00 — todo lo que se muestra como "de la vela" debe referirse a este
 * instante, no a `now`.
 */
export function ultimaVelaCerrada(ahora: number = Date.now()): number {
  return Math.floor(ahora / 3600e3) * 3600e3;
}

/**
 * Ultimo registro de cada dia UTC. Obligatorio para comparar contra el benchmark
 * (diario) y para agregar por cliente: sumar las 24 barras de un dia infla el
 * total 24 veces.
 */
export function ultimoPorDia<T extends { ts: string }>(rows: T[]): T[] {
  const porDia = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.ts.localeCompare(b.ts))) porDia.set(r.ts.slice(0, 10), r);
  return Array.from(porDia.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => r);
}

// ---------------------------------------------------------------------------
// 6. Costos y resumenes de periodo
// ---------------------------------------------------------------------------

/**
 * Desde esta fecha el sync diario de COMMISSION en account_income esta completo.
 * Antes, el backfill del ledger tiene huecos (verificado 2026-08-12: -24,18 USD
 * en el ledger contra -44,03 en trades) — para comisiones historicas la fuente
 * fiable es `trades.commission`.
 */
export const COMMISSION_BACKFILL_OK = Date.parse("2026-07-13T00:00:00Z");

/**
 * Comisiones agregadas por mes UTC ("YYYY-MM" -> USD, negativo), con la fuente
 * conmutada por fecha: trades antes del 13-jul-2026, ledger despues. Nunca se
 * suman las dos fuentes en el mismo tramo (doble conteo).
 */
export function comisionesPorMes(
  trades: { ts: string; commission?: number | null }[],
  comisionLedger: { ts: string; usd: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (ts: string, v: number) => {
    if (!v) return;
    const mes = ts.slice(0, 7);
    out.set(mes, (out.get(mes) ?? 0) + v);
  };
  for (const t of trades) if (ms(t.ts) < COMMISSION_BACKFILL_OK) add(t.ts, num(t.commission));
  for (const c of comisionLedger) if (ms(c.ts) >= COMMISSION_BACKFILL_OK) add(c.ts, num(c.usd));
  return out;
}

/**
 * Resumen de un periodo (la "semana" del dashboard): % time-weighted y USD del
 * bot, calculados sobre las series canonicas — nunca equity/equity_base.
 */
export function resumenPeriodo(
  curva: Punto[],
  serie: { x: number; pnl: number }[],
  desde: number,
  hasta: number = Date.now(),
): { pct: number | null; usd: number | null } {
  return { pct: twrEntre(curva, desde, hasta), usd: pnlEntre(serie, desde, hasta) };
}

/**
 * true si la serie cubre la vida entera de la cuenta. Si es false (consulta
 * truncada por limite de filas), la UI debe decir "desde DD/MM", no "desde tu
 * entrada".
 */
export function serieCompleta(snaps: SnapLike[], createdAt: string | null | undefined): boolean {
  if (!snaps.length || !createdAt) return false;
  // margen de 48 h: entre el alta del cliente y su primer snapshot pasan horas
  return ms(snaps[0].ts) <= ms(createdAt) + 48 * 3600e3;
}

// ---------------------------------------------------------------------------
// 8. Retorno MONEY-WEIGHTED (Modified Dietz)
// ---------------------------------------------------------------------------
/**
 * QUE PROBLEMA RESUELVE, con el caso que lo motivo.
 *
 * Roberto, agosto 2026: TWR desde su entrada −3,54 % de mercado y −0,01 % con
 * la reparacion, pero su resultado en dinero es −39,54 USD de mercado y
 * +153,41 USD con la reparacion. El porcentaje dice que perdio y el importe
 * dice que gano. Las dos cifras son correctas: responden a preguntas distintas.
 *
 *   TWR  (time-weighted)  — como rindio UN DOLAR invertido todo el tramo.
 *                           Neutraliza el momento y el tamano de los aportes,
 *                           que el gestor no decide. Es el estandar GIPS para
 *                           publicar la gestion y el UNICO comparable contra un
 *                           indice. Es lo que Kuve publica, y no cambia.
 *
 *   MWR  (money-weighted) — como rindio SU DINERO, ponderando cada tramo por el
 *                           capital que de verdad tenia en juego. Es la cifra
 *                           cuyo signo coincide siempre con el del importe.
 *
 * Con cero flujos las dos coinciden exactamente. Divergen cuando hay aportes, y
 * pueden hasta cambiar de signo: Roberto perdio cuando la cuenta era chica
 * (2.490 USD en julio) y cobro la reparacion cuando ya era grande (7.244 USD el
 * 27-ago). Ponderado por capital gana; por dolar invertido, no.
 *
 * POR QUE MODIFIED DIETZ Y NO LA TIR. La TIR exige resolver iterativamente y
 * puede no tener solucion unica con flujos de signo mixto. Modified Dietz es la
 * aproximacion estandar del sector —la que GIPS acepta para periodos con
 * flujos— y es cerrada:
 *
 *     R = G / (BV + SUM(w_i * F_i))        w_i = (T - t_i) / T
 *
 * es decir, cada aporte cuenta en el denominador solo por la FRACCION DEL TRAMO
 * que estuvo invertido. Los 2.000 USD que Roberto ingreso el 27-ago pesan 1/55
 * en su denominador, no 1: contarlos enteros diria que su dinero rindio mucho
 * peor de lo que rindio.
 *
 * NUNCA COMPARAR ESTO CON EL INDICE. El benchmark se publica time-weighted;
 * enfrentarle un money-weighted compara dos cosas distintas y el cliente leeria
 * como habilidad (o torpeza) del gestor lo que solo es el calendario de sus
 * propios depositos.
 *
 * @param ganancia  resultado del tramo en USD (ya neto de costos).
 * @param bvUsd     capital al inicio del tramo (para una cuenta que nace en
 *                  `desde`, su capital fundacional).
 * @param flujos    aportes (+) y retiros (-). Solo cuentan los de (desde, hasta].
 */
export function modifiedDietz(
  ganancia: number,
  bvUsd: number,
  flujos: Flujo[],
  desde: number,
  hasta: number,
): { pct: number | null; capitalMedio: number; flujoNeto: number } {
  const T = hasta - desde;
  const dentro = flujos.filter((f) => f.t > desde && f.t <= hasta);
  const flujoNeto = dentro.reduce((a, f) => a + f.usd, 0);
  if (!(T > 0) || !isFinite(bvUsd)) return { pct: null, capitalMedio: NaN, flujoNeto };

  // Peso = fraccion del tramo que ese dinero estuvo trabajando. Se acota a
  // [0,1]: un flujo fuera de ventana ya quedo filtrado, pero un timestamp
  // sucio no puede meter un peso negativo en el denominador.
  const capitalMedio = bvUsd + dentro.reduce((a, f) => {
    const w = Math.min(1, Math.max(0, (hasta - f.t) / T));
    return a + w * f.usd;
  }, 0);

  // Denominador <= 0: la cuenta se vacio o los retiros superan lo aportado. No
  // hay tasa que describa eso; devolver un numero seria inventarlo.
  if (!(capitalMedio > 0) || !isFinite(ganancia)) return { pct: null, capitalMedio, flujoNeto };
  return { pct: (ganancia / capitalMedio) * 100, capitalMedio, flujoNeto };
}

// ---------------------------------------------------------------------------
// 9. Resumen de cuenta: LA MISMA cifra en todas las pantallas
// ---------------------------------------------------------------------------
/**
 * QUE PROBLEMA RESUELVE. El 28-ago-2026 una auditoria encontro que el dashboard
 * y /performance publicaban DOS "rendimiento desde tu entrada" y DOS drawdowns
 * distintos para el mismo cliente y el mismo instante: el dashboard encadenaba
 * el tramo en vivo (precios de Binance cada 15 s) y /performance se detenia en
 * la ultima vela. Dos numeros bajo el mismo rotulo, cambiando uno de ellos cada
 * 15 segundos.
 *
 * La regla del proyecto es explicita: toda cifra que ve el cliente se calcula
 * igual en todas las pantallas, y a la ultima vela cerrada. Esta funcion es esa
 * cifra. El tramo en vivo NO desaparece —es util y el cliente lo pide— pero
 * viaja en su propio campo y quien lo pinte debe rotularlo "en vivo".
 *
 * TAMBIEN unifica el benchmark. La app comparaba la cuenta contra el indice
 * BRUTO, que no descuenta comisiones ni funding: el indice gana siempre, y no
 * porque la gestion sea peor. El informe compara contra el indice NETO del
 * arrastre real de esta cuenta, y esa es la comparacion valida.
 */
export type ResumenCuenta = {
  /** Corte usado: `min(ahora, ultimaVelaCerrada())`. El mismo del informe. */
  corte: number;
  /** LA cifra canonica: TWR desde la entrada hasta la ultima vela cerrada. */
  twrDesdeEntrada: number | null;
  /** El mismo TWR con el tramo vivo encadenado. null si no se paso equity vivo. */
  twrVivo: number | null;
  /** Caida maxima sobre la curva cerrada. */
  ddMax: number | null;
  /** Caida maxima incluyendo el punto vivo. */
  ddMaxVivo: number | null;
  /** Indice del perfil en la misma ventana, BRUTO. */
  benchBruto: number | null;
  /**
   * El indice menos el arrastre de costos REAL de esta cuenta. Es la unica
   * comparacion valida contra la cuenta, y la que publica el informe.
   */
  benchNeto: number | null;
  /** El arrastre, en % y NEGATIVO. Se publica para poder auditar `benchNeto`. */
  arrastrePct: number;
};

/**
 * Arrastre de costos del tramo, en % del equity medio. NEGATIVO = cuesta.
 *
 * Vive aqui y no en `reportes/lib/informe.ts` para que la app y el informe usen
 * la misma: si cada uno calcula su propio "indice neto", vuelven a ser dos
 * cifras distintas del mismo concepto, que es justo lo que esto corrige.
 */
export function arrastreCostos(
  snaps: SnapLike[],
  comisionFills: { ts: string; usd: number }[],
  fundingFills: { ts: string; usd: number }[],
  desde: number, hasta: number,
): number {
  const enTramo = (ts: string) => { const t = ms(ts); return t > desde && t <= hasta; };
  const c = comisionFills.filter((x) => enTramo(x.ts)).reduce((a, x) => a + num(x.usd), 0);
  const f = fundingFills.filter((x) => enTramo(x.ts)).reduce((a, x) => a + num(x.usd), 0);
  const eqs = snaps.filter((x) => enTramo(x.ts)).map((x) => num(x.equity)).filter((v) => v > 1);
  if (!eqs.length) return 0;
  const medio = eqs.reduce((a, v) => a + v, 0) / eqs.length;
  return medio > 0 ? ((c + f) / medio) * 100 : 0;
}

export function resumenCuenta(
  snaps: SnapLike[],
  flujos: Flujo[],
  heredadoFills: HeredadoFill[],
  bench: BenchLike[],
  opts: {
    /** Equity de ahora mismo, para el tramo vivo. Omitir = solo cifras cerradas. */
    equityVivo?: number | null;
    comisionFills?: { ts: string; usd: number }[];
    fundingFills?: { ts: string; usd: number }[];
  } = {},
): ResumenCuenta {
  const s = sanearSnaps(snaps);
  const vacio: ResumenCuenta = {
    corte: ultimaVelaCerrada(), twrDesdeEntrada: null, twrVivo: null,
    ddMax: null, ddMaxVivo: null, benchBruto: null, benchNeto: null, arrastrePct: 0,
  };
  const inception = inceptionTs(s);
  if (!s.length || inception == null) return vacio;

  // EL MISMO corte que el informe. Sin esto la app va una barra por delante y
  // publica un rendimiento que el PDF del mismo dia no reconoce.
  const corte = Math.min(Date.now(), ultimaVelaCerrada());
  const curva = curvaTwr(s, flujos, heredadoFills);
  const twrDesdeEntrada = twrEntre(curva, inception, corte);

  const factorVivo = opts.equityVivo != null
    ? factorVivo_(s, flujos, heredadoFills, opts.equityVivo) : null;
  const twrVivo = factorVivo != null ? (factorVivo - 1) * 100 : null;

  const ys = curva.map((p) => p.y);
  const ddMax = ys.length ? maxDrawdown(ys) : null;
  const ddMaxVivo = ys.length
    ? maxDrawdown([...ys, ...(factorVivo != null ? [factorVivo] : [])]) : null;

  const benchBruto = benchmarkEnVentana(bench, inception, corte);
  const arrastrePct = arrastreCostos(
    s, opts.comisionFills ?? [], opts.fundingFills ?? [], inception, corte);
  // `arrastrePct` ya viene negativo: se SUMA.
  const benchNeto = benchBruto == null ? null : benchBruto + arrastrePct;

  return { corte, twrDesdeEntrada, twrVivo, ddMax, ddMaxVivo, benchBruto, benchNeto, arrastrePct };
}

/** Alias interno: `factorVivo` ya existe exportada mas arriba con otro nombre. */
const factorVivo_ = factorVivo;
