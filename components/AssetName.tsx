"use client";
import { ASSET_INFO } from "@/lib/assets";
import { fmtUsd } from "@/lib/format";

/** Asset ticker with hover/tap tooltip: full name · sector · last price. */
export default function AssetName({ symbol, price }: { symbol: string; price?: number | null }) {
  const info = ASSET_INFO[symbol] ?? { name: symbol, sector: "Futuro" };
  const tip = `${info.name} · ${info.sector}${price != null ? ` · $${fmtUsd(price)}` : ""}`;
  return (
    <span className="asset" tabIndex={0} data-tip={tip}>
      {symbol.replace("USDT", "")}
    </span>
  );
}
