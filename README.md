# KUVE Finance — Client Web App (MFT=11)

Mobile-first client portal: Supabase Auth, Binance key management, live dashboards.

## Run locally
```bash
cp .env.local.example .env.local   # values already point to the Asset Optimizer project
npm install
npm run dev                        # http://localhost:3000
```

## Deploy (Vercel)
1. Push this folder to a Git repo, import in Vercel.
2. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.local.example`).
3. In Supabase → Auth → URL Configuration, add the Vercel URL to Site URL / Redirect URLs.

## Pages
- `/login`, `/register` — Supabase Auth (a `clients` row is auto-created by DB trigger on signup)
- `/dashboard` — balance, equity, uPnL, exposure, open positions, portfolio donut
- `/history` — trades, orders, strategy status per symbol
- `/performance` — equity curve, drawdown chart, current allocation
- `/profile` — name, risk profile selector, Binance API keys (validated + stored in
  Supabase Vault via Edge Functions — the browser never reads them back), enable/disable
  bot with flatten / wind-down choice

## Security model
- The browser uses only the anon key + RLS: each client sees exclusively their own rows.
- API keys go to the `store-binance-keys` Edge Function, which validates them against
  Binance and stores them in Supabase Vault. No table readable by clients contains keys.
- Settings changes go through the `update_client_settings` RPC (no direct table writes).
