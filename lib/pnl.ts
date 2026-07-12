/**
 * Atribución del PnL al BOT a partir del ledger de Binance (account_income).
 * Regla: un cierre (REALIZED_PNL) cuenta para el bot solo si el bot registró
 * antes la apertura de esa posición (trade con profit=0 del mismo símbolo, al
 * menos 2 min antes del fill). Los cierres de posiciones previas al bot
 * (heredadas/adoptadas) se separan en `heredado` y NO entran al PnL del bot.
 * Comisiones: cuentan las de fills ejecutados por el bot (fill cerca de un
 * trade registrado, ±5 min) o de posiciones abiertas por él.
 */
export type IncomeRow = { income_type: string; income: number; ts: string; symbol: string | null };
export type BotTradeLike = { symbol: string | null; ts: string; profit: number | null };

export type Attribution = {
  mercado: number;      // cierres atribuibles al bot
  heredado: number;     // cierres de posiciones previas al bot (excluido)
  comisiones: number;
  funding: number;
  transfers: number;
  realizadoNeto: number; // mercado + comisiones + funding
  hasta: string | null;  // último fill sincronizado
};

export function attributeIncome(rows: IncomeRow[], botTrades: BotTradeLike[]): Attribution | null {
  if (!rows.length) return null;
  const opensBefore = (sym: string | null, ts: string, marginMs: number) =>
    !!sym && botTrades.some((tr) => tr.symbol === sym && !tr.profit &&
      new Date(tr.ts).getTime() < new Date(ts).getTime() - marginMs);
  const nearTrade = (sym: string | null, ts: string, winMs: number) =>
    !!sym && botTrades.some((tr) => tr.symbol === sym &&
      Math.abs(new Date(tr.ts).getTime() - new Date(ts).getTime()) <= winMs);
  let mercado = 0, heredado = 0, comisiones = 0, funding = 0, transfers = 0;
  for (const x of rows) {
    const v = Number(x.income || 0);
    if (x.income_type === "REALIZED_PNL") {
      if (opensBefore(x.symbol, x.ts, 120e3)) mercado += v; else heredado += v;
    } else if (x.income_type === "COMMISSION") {
      if (nearTrade(x.symbol, x.ts, 300e3) || opensBefore(x.symbol, x.ts, 120e3)) comisiones += v;
    } else if (x.income_type === "FUNDING_FEE") funding += v;
    else if (x.income_type === "TRANSFER") transfers += v;
  }
  return {
    mercado, heredado, comisiones, funding, transfers,
    realizadoNeto: mercado + comisiones + funding,
    hasta: rows.map((x) => x.ts).sort().slice(-1)[0] ?? null,
  };
}
