/**
 * Cabeceras de seguridad. La app muestra saldos nominativos y desde /profile se
 * cargan claves de API de Binance: sin `frame-ancestors` cualquier sitio podia
 * embeberla en un iframe transparente y capturar clics sobre "Pausar bot" o
 * sobre el formulario de claves (clickjacking).
 *
 * El CSP se limita a directivas que NO pueden romper el render (Next inyecta
 * estilos y scripts inline propios, asi que un `script-src`/`style-src`
 * estricto necesita nonces y hay que probarlo pagina por pagina — queda
 * pendiente y anotado, no se pone a medias).
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },                 // respaldo para navegadores sin CSP nivel 2
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // 2 anios + preload: Vercel ya sirve solo por HTTPS, esto cierra el primer viaje.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
export default nextConfig;
