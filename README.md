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
2. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.local.example`),
   plus the server-only `SUPABASE_SERVICE_ROLE_KEY` and `KUVE_PIN_PEPPER` (see "Acceso con PIN").
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

## Acceso con PIN

Los clientes invitados entran con **email + PIN de 6 dígitos** (`/invite/[token]` para el
alta, `/login` para entrar). El PIN nunca se guarda: la contraseña real de Supabase Auth es
`HMAC-SHA256(KUVE_PIN_PEPPER, email + "
" + pin)` en base64url (`lib/pin.ts`). Sin el pepper,
un volcado de `auth.users` no permite adivinar el PIN; el pepper solo vive en las variables de
entorno de Vercel (production + preview), nunca en código cliente ni con prefijo `NEXT_PUBLIC_`.

Routes de servidor (`app/api/**`, runtime Node, leen `process.env` en cada petición):

| Route | Body | Respuestas |
|---|---|---|
| `POST /api/invite/accept` | `{ token, pin }` | `200 {ok,email}` + cookies · `400` PIN/token mal · `409` email ya con cuenta · `410 {estado}` usada/caducada/inexistente · `500` |
| `POST /api/pin/login` | `{ email, pin }` | `200 {ok}` + cookies · `400` · `401 {error:"Email o PIN incorrectos"}` (idéntico si el email no existe) · `423 {segundos}` bloqueado · `500` |
| `POST /api/pin/set` | `{ pin }` (sesión) | `200 {ok}` · `400` · `401` sin sesión · `500`. **Sustituye la contraseña** del cliente por la derivada del PIN |

Fuerza bruta: `pin_attempts` (solo service role) cuenta fallos por email; al 5.º fallo se
bloquea 15 min (`423` con segundos restantes) y el contador vuelve a 0. Un login correcto borra
la fila. PIN rechazados: no 6 dígitos, seis iguales, `123456`, `654321`, `123123`, `112233`, `123321`.

Variables (`.env.local.example`):
- `SUPABASE_SERVICE_ROLE_KEY` — panel de Supabase; crea usuarios y consume invitaciones (`accept_invite`).
- `KUVE_PIN_PEPPER` — `openssl rand -base64 32`. **Cambiarlo invalida todos los PIN**: habría que
  re-invitar a cada cliente o que cada uno cree PIN nuevo desde el perfil (con sesión abierta).

Tests: `npm test` (vitest; los routes se prueban con `vi.mock` de `lib/supabase/{admin,route}`).
