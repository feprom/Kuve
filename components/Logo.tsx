/* eslint-disable @next/next/no-img-element */
"use client";

/** Logo desde /public: antes era un data-URI JPEG de ~33 KB embebido en el
 *  bundle JS de TODAS las rutas, sin caché de imagen. El fichero estático se
 *  cachea una vez y no viaja en el JS. width/height explícitos evitan CLS. */
export default function Logo({ height = 40 }: { height?: number }) {
  // el JPEG original es cuadrado (1:1)
  return (
    <img src="/kuve-logo.jpg" alt="KUVE Finance" width={height} height={height}
      style={{ height, width: "auto", display: "block" }} />
  );
}
