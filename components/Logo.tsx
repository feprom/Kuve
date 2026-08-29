/* eslint-disable @next/next/no-img-element */
"use client";

/**
 * Logo de la aplicacion: el cerebro KUVE.
 *
 * DE DONDE SALE. El original (`KUVEFINANCE.png`) esta pintado SOBRE NEGRO —sus
 * cuatro esquinas son 0,0,0—, asi que no se puede servir tal cual sobre nada
 * que no sea negro puro. El fichero de aqui se deriva recortando el fondo con
 * la luminancia como canal alfa, SIN despremultiplicar el color: el arte es un
 * neon aditivo, y dividir por el alfa —el paso que pediria una imagen
 * premultiplicada— empuja cada trazo hacia el blanco y deja el cerebro lavado e
 * invisible. Compuesto sobre negro reproduce el original pixel a pixel; sobre
 * el panel `#0b0e13` se comporta como el resplandor que es.
 *
 * Fichero estatico y no data-URI: antes viajaba un JPEG de ~33 KB embebido en
 * el bundle JS de TODAS las rutas y sin cache de imagen. `width`/`height`
 * explicitos evitan que la pagina salte al cargar.
 */
export default function Logo({ height = 40 }: { height?: number }) {
  // El PNG es cuadrado: el alto manda y el ancho lo iguala.
  return (
    <img
      src="/kuve-brain.png"
      alt="KUVE Finance"
      width={height}
      height={height}
      style={{ height, width: height, display: "block" }}
    />
  );
}
