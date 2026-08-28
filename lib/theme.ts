/**
 * Tokens del tema en hex, para el canvas.
 *
 * POR QUE EXISTE ESTE FICHERO. Lightweight Charts pinta sobre canvas y el canvas
 * no resuelve `var(--x)`: hay que darle un hex literal. Ese mapa vivia DUPLICADO
 * en PerfChart.tsx y LineChart.tsx, y al cambiar `--strategy` en globals.css los
 * dos siguieron pintando el color viejo — la hoja de estilos decia una cosa y la
 * grafica dibujaba otra. Un valor con dos copias acaba divergiendo siempre; aqui
 * hay una sola.
 *
 * SIGUE SIENDO UNA COPIA de globals.css, porque no hay forma de leer una
 * variable CSS desde el canvas sin montar el DOM primero. Al tocar un token del
 * tema hay que tocarlo en los dos sitios, y el comentario de globals.css lo dice.
 *
 * DISCIPLINA DE COLOR: verde y rojo significan SOLO ganancia y perdida. La
 * direccion de una posicion (largo/corto) y el origen de un importe (bot, falla
 * tecnica, reparacion) usan otros tonos — estar corto no es "malo" ni estar
 * largo es "bueno", y pintarlo asi hace que el cliente lea una posicion como si
 * fuera un resultado.
 */
export const HEX: Record<string, string> = {
  "var(--accent)": "#29a9e1",
  // Naranja, no verde: el verde ya es "ganancia". Es el mismo tono con el que el
  // informe pinta el bot (reportes/lib/graficos.ts, COLORES.estrategia).
  "var(--strategy)": "#c9822e",
  "var(--green)": "#35c98e",
  "var(--red)": "#e05d75",
};

/** Token del tema -> hex. Cualquier otra cosa pasa tal cual. */
export const hex = (c: string) => HEX[c] ?? c;
