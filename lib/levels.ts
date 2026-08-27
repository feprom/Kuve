/**
 * Niveles de salida del motor para posiciones abiertas, replicando exactamente
 * data_v3_backtester.positions():
 *   - stop dinámico (trailing ATR): corto = mín(low desde entrada) + ATR×mult
 *                                   largo = máx(high desde entrada) − ATR×mult
 *   - salida de canal: corto = máx(high de las últimas `xl` velas cerradas)
 *                      largo = mín(low de las últimas `xl` velas cerradas)
 *   - SL efectivo = el que se toque primero (corto: mín de ambos; largo: máx).
 * ATR = SMA del true range (`ap` velas 1h). Velas: Binance fapi público.
 */

export type SymbolParams = { xl: number; ap: number; am: number };

/** Parámetros oos del grid (results_v6/grid_best_per_asset.csv) — cartera producción. */
export const STRATEGY_PARAMS: Record<string, SymbolParams> = {
  BTCUSDT: { xl: 168, ap: 96, am: 7.0 },
  SOLUSDT: { xl: 168, ap: 96, am: 8.0 },
  BNBUSDT: { xl: 168, ap: 72, am: 7.0 },
  TRXUSDT: { xl: 168, ap: 48, am: 8.0 },
  XAUUSDT: { xl: 168, ap: 96, am: 9.0 },
  XAGUSDT: { xl: 252, ap: 48, am: 8.0 },
  CLUSDT: { xl: 168, ap: 72, am: 9.0 },
  NATGASUSDT: { xl: 252, ap: 96, am: 10.0 },
};

export type Levels = {
  price: number;
  slTrail: number;   // stop dinámico (trailing ATR)
  slChan: number;    // salida de canal
  slEff: number;     // el que se toca primero
  best: number;      // mejor precio desde la entrada (extremo del trailing = lado de toma de ganancias)
  distPct: number;   // distancia del precio al SL efectivo (%; margen restante)
  lockedPct: number; // % asegurado respecto a la entrada (>0 = el stop ya protege ganancia)
  beTrigger: number; // precio que el mercado debe tocar para que el stop cruce la entrada
                     // (breakeven): corto = entrada − am×ATR; largo = entrada + am×ATR.
                     // Más allá de ese nivel, cada nuevo extremo asegura más ganancia.
};

const FAPI = "https://fapi.binance.com/fapi/v1";

export async function computeLevels(
  symbol: string,
  sideNum: 1 | -1,
  entryMs: number,
  entryPrice: number,
  params?: SymbolParams,
): Promise<Levels | null> {
  const prm = params ?? STRATEGY_PARAMS[symbol];
  if (!prm) return null;
  try {
    const t0 = entryMs - (prm.ap + prm.xl + 10) * 3600e3;
    // Binance devuelve como mucho 1500 velas por llamada. Con una sola, la
    // ventana ARRANCA en t0 y TERMINA 1500 h despues: pasados ~51 dias desde la
    // entrada la ultima vela devuelta ya no es la actual, y `price`, `chanHi`,
    // `chanLo`, `loSince` y `hiSince` se calculan sobre un mercado viejo que se
    // aleja un dia por dia (la SOL de Denise lleva 54 dias abierta). Encadenamos
    // paginas hasta alcanzar la vela en curso.
    const kl: any[][] = [];
    let cursor = t0;
    for (let pag = 0; pag < 8; pag++) {   // 8 x 1500 h = ~500 dias, tope de seguridad
      const res = await fetch(`${FAPI}/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&limit=1500`);
      if (!res.ok) return kl.length ? null : null;
      const lote: any[][] = await res.json();
      if (!lote.length) break;
      // La primera vela del lote siguiente repite la ultima del anterior.
      for (const k of lote) if (!kl.length || +k[0] > +kl[kl.length - 1][0]) kl.push(k);
      const ultimaApertura = +lote[lote.length - 1][0];
      if (lote.length < 1500 || ultimaApertura >= Date.now() - 3600e3) break;
      cursor = ultimaApertura + 1;
    }
    if (!kl.length) return null;
    const h = kl.map((k) => +k[2]);
    const l = kl.map((k) => +k[3]);
    const c = kl.map((k) => +k[4]);
    const t = kl.map((k) => +k[0]);
    const n = kl.length;
    const price = c[n - 1];
    // ATR = SMA del true range, idéntico al motor
    let atr = 0;
    for (let i = Math.max(1, n - prm.ap); i < n; i++) {
      atr += Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    atr /= Math.min(prm.ap, n - 1);
    let ei = t.findIndex((x) => x >= entryMs);
    if (ei < 0) ei = n - 1;
    const a = Math.max(0, n - 1 - prm.xl);
    const chanHi = Math.max(...h.slice(a, n - 1));
    const chanLo = Math.min(...l.slice(a, n - 1));
    const loSince = Math.min(...l.slice(ei));
    const hiSince = Math.max(...h.slice(ei));
    const short = sideNum < 0;
    const slTrail = short ? loSince + prm.am * atr : hiSince - prm.am * atr;
    const slChan = short ? chanHi : chanLo;
    const slEff = short ? Math.min(slTrail, slChan) : Math.max(slTrail, slChan);
    const best = short ? loSince : hiSince;
    const distPct = (short ? slEff / price - 1 : 1 - slEff / price) * 100;
    const lockedPct = entryPrice ? (short ? 1 - slEff / entryPrice : slEff / entryPrice - 1) * 100 : 0;
    const beTrigger = short ? entryPrice - prm.am * atr : entryPrice + prm.am * atr;
    return { price, slTrail, slChan, slEff, best, distPct, lockedPct, beTrigger };
  } catch {
    return null;
  }
}
