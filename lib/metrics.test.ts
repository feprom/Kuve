import { describe, expect, it, vi } from "vitest";

import {
  arrastreCostos,
  benchmarkEnVentana,
  capitalAportado,
  compuestaTwr,
  comisionesPorMes,
  detectarFlujos,
  factorVivo,
  maxDrawdown,
  maxDrawdownEntre,
  modifiedDietz,
  pnlEntre,
  sanearSnaps,
  seriePnl,
  twr,
  twrEntre,
  ultimoPorDia,
  type Flujo,
  type Punto,
  type SnapLike,
} from "./metrics";

const instante = (iso: string) => Date.parse(iso);
const flujo = (ts: string, usd: number): Flujo => ({ t: instante(ts), usd, fuente: "ledger" });
const snap = (ts: string, equity: number, extras: Partial<SnapLike> = {}): SnapLike => ({ ts, equity, ...extras });

describe("sanearSnaps", () => {
  it("conserva la ultima barra duplicada, ordena y fija inception solo al superar 1 USD", () => {
    const serie = sanearSnaps([
      snap("2026-01-04T00:00:00Z", 20),
      snap("2026-01-01T00:00:00Z", 0),
      snap("2026-01-03T00:00:00Z", 10, { realized_cum: 1 }),
      snap("2026-01-02T00:00:00Z", 1),
      snap("2026-01-03T00:00:00Z", 12, { realized_cum: 2 }), // recuperacion posterior: esta fila manda
      snap("2026-01-05T00:00:00Z", -3),
      snap("2026-01-06T00:00:00Z", Number.NaN),
    ]);

    expect(serie).toEqual([
      snap("2026-01-03T00:00:00Z", 12, { realized_cum: 2 }),
      snap("2026-01-04T00:00:00Z", 20),
    ]);
  });

  it("devuelve vacio cuando ningun saldo supera el minimo de inception", () => {
    expect(sanearSnaps([
      snap("2026-01-01T00:00:00Z", 0),
      snap("2026-01-02T00:00:00Z", 1),
      snap("2026-01-03T00:00:00Z", -1),
    ])).toEqual([]);
  });
});

describe("TWR", () => {
  it("encadena la gestion y neutraliza un deposito registrado en la misma barra", () => {
    const snaps = [
      snap("2026-01-01T00:00:00Z", 100),
      snap("2026-01-02T00:00:00Z", 110), // +10 %: 100 -> 110
      // 110 + 11 de gestion + 1.000 de aporte = 1.121; el aporte no es retorno.
      snap("2026-01-03T00:00:00Z", 1_121),
    ];

    // Dos tramos de +10 %: 1,10 × 1,10 - 1 = +21 %, no +1.010 % por el deposito.
    expect(twr(snaps, [flujo("2026-01-03T00:00:00Z", 1_000)])).toBeCloseTo(21, 10);
  });

  it("no atribuye rendimiento a un deposito puro", () => {
    const snaps = [snap("2026-01-01T00:00:00Z", 100), snap("2026-01-02T00:00:00Z", 1_100)];

    // 100 iniciales + 1.000 aportados = 1.100; la gestion gano exactamente 0 USD.
    expect(twr(snaps, [flujo("2026-01-02T00:00:00Z", 1_000)])).toBeCloseTo(0, 10);
  });

  it("no publica retorno para series vacias o con una unica barra", () => {
    expect(twr([], [])).toBeNull();
    expect(twr([snap("2026-01-01T00:00:00Z", 100)], [])).toBeNull();
  });

  it("neutraliza tambien un aporte posterior a la ultima vela en el tramo vivo", () => {
    const ultima = instante("2026-01-02T00:00:00Z");
    const ahora = instante("2026-01-03T00:00:00Z");
    const snaps = [snap("2026-01-01T00:00:00Z", 100), snap("2026-01-02T00:00:00Z", 110)];

    // El TWR cerrado es +10 %. En vivo: 110 + 1.000 de deposito = 1.110, sin ganancia adicional.
    expect(factorVivo(snaps, [flujo("2026-01-02T12:00:00Z", 1_000)], [], 1_110, ahora))
      .toBeCloseTo(1.1, 10);
    expect(ultima).toBeLessThan(ahora);
  });
});

describe("Modified Dietz", () => {
  it("pondera un aporte tardio solo por el tiempo que estuvo invertido", () => {
    const desde = instante("2026-01-01T00:00:00Z");
    const hasta = instante("2026-01-11T00:00:00Z");
    const resultado = modifiedDietz(120, 1_000, [flujo("2026-01-09T00:00:00Z", 1_000)], desde, hasta);

    // El aporte entra al dia 8 de 10: trabaja 2/10. Capital medio = 1.000 + 0,2×1.000 = 1.200.
    // Ganancia 120 / capital medio 1.200 = +10 %.
    expect(resultado).toEqual({ pct: 10, capitalMedio: 1_200, flujoNeto: 1_000 });
  });

  it("sin flujos coincide con el retorno simple del capital inicial", () => {
    const desde = instante("2026-01-01T00:00:00Z");
    const hasta = instante("2026-01-11T00:00:00Z");

    // 75 USD sobre 500 USD durante todo el periodo: 75 / 500 = +15 %.
    expect(modifiedDietz(75, 500, [], desde, hasta)).toEqual({ pct: 15, capitalMedio: 500, flujoNeto: 0 });
  });

  it("rechaza una tasa inventada cuando un retiro deja capital medio no positivo", () => {
    const desde = instante("2026-01-01T00:00:00Z");
    const hasta = instante("2026-01-11T00:00:00Z");
    const resultado = modifiedDietz(1, 100, [flujo("2026-01-01T00:00:01Z", -200)], desde, hasta);

    expect(resultado.pct).toBeNull();
    expect(resultado.capitalMedio).toBeLessThan(0);
  });
});

describe("compuestaTwr", () => {
  it("pondera por capital inicial del tramo y no promedia porcentajes de clientes", () => {
    const t0 = instante("2026-01-01T00:00:00Z");
    const t1 = instante("2026-01-02T00:00:00Z");
    const curva = compuestaTwr([
      { curva: [{ x: t0, y: 1 }, { x: t1, y: 2 }], equity: [{ x: t0, y: 100 }, { x: t1, y: 200 }] },
      { curva: [{ x: t0, y: 1 }, { x: t1, y: 0.9 }], equity: [{ x: t0, y: 9_900 }, { x: t1, y: 8_910 }] },
    ]);

    // Cliente chico: +100 % sobre 100. Cliente grande: -10 % sobre 9.900.
    // Retorno del libro = (100×100 % + 9.900×-10 %) / 10.000 = -8,9 %; no +45 % de media simple.
    expect(curva).toHaveLength(2);
    expect(curva[0]).toEqual({ x: t0, y: 1 });
    expect(curva[1]).toMatchObject({ x: t1 });
    expect(curva[1].y).toBeCloseTo(0.911, 10);
  });
});

describe("drawdown", () => {
  it("mide la peor caida desde cualquier maximo anterior e ignora valores no finitos", () => {
    // El minimo posterior al pico 180 es 90: 90 / 180 - 1 = -50 %.
    expect(maxDrawdown([100, Number.NaN, 150, 120, 180, 90])).toBeCloseTo(-50, 10);
  });

  it("mide desde el nivel VIGENTE en `desde`, no desde el pico historico anterior", () => {
    const curva: Punto[] = [{ x: 1, y: 200 }, { x: 2, y: 180 }, { x: 3, y: 100 }];

    // El pico de 200 es de ANTES de la ventana y no cuenta: al abrir el periodo
    // la cuenta ya valia 180, y eso es lo que el cliente tenia. 100/180-1 =
    // -44,44 %. Atribuirle a este periodo la caida desde 200 seria cobrarle dos
    // veces una perdida que ya se reporto en el periodo anterior.
    expect(maxDrawdownEntre(curva, 2, 3)).toBeCloseTo(-44.4444444444, 8);
  });

  it("ancla en el ultimo valor previo cuando la ventana no empieza en un punto de la serie", () => {
    // Para esto existe la siembra: sin ella, una ventana que abre entre dos
    // puntos empezaria a contar desde el primer valor de DENTRO (100) y daria
    // 0 % de drawdown, escondiendo por completo la caida.
    const curva: Punto[] = [{ x: 1, y: 200 }, { x: 3, y: 100 }];
    expect(maxDrawdownEntre(curva, 2, 3)).toBeCloseTo(-50, 10);
  });
});

describe("flujos y PnL", () => {
  it("usa el ledger blanco una sola vez y no inventa un salto cuando ese ledger explica la barra", () => {
    const advertencia = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const flujos = detectarFlujos(
      [snap("2026-01-01T00:00:00Z", 100), snap("2026-01-02T00:00:00Z", 1_100)],
      [
        { income_type: "TRANSFER", income: 1_000, ts: "2026-01-02T00:00:00Z" },
        { income_type: "TRANSFER", income: 1_000, ts: "2026-01-02T00:00:00Z" }, // sync duplicado
        { income_type: "COMMISSION", income: -5, ts: "2026-01-02T00:00:00Z" },
        { income_type: "REFERRAL_KICKBACK", income: 5, ts: "2026-01-02T00:00:00Z" },
      ],
    );
    advertencia.mockRestore();

    // 100 -> 1.100 se explica integramente por TRANSFER; no debe aparecer un segundo flujo "salto".
    expect(flujos).toEqual([flujo("2026-01-02T00:00:00Z", 1_000)]);
  });

  it("separa aportes y cierres heredados del PnL que se atribuye al bot", () => {
    const serie = seriePnl(
      [snap("2026-01-01T00:00:00Z", 100, { start_equity: 100 }), snap("2026-01-02T00:00:00Z", 1_170)],
      [flujo("2026-01-02T00:00:00Z", 1_000)],
      [{ ts: "2026-01-02T00:00:00Z", usd: 50 }],
    );

    // Equity final 1.170 - capital aportado 1.100 - cierre heredado 50 = PnL real del bot: 20 USD.
    expect(serie.at(-1)).toMatchObject({ pnl: 20, base: 1_100 });
    expect(capitalAportado([snap("2026-01-01T00:00:00Z", 100)], [flujo("2026-01-02T00:00:00Z", 1_000)], instante("2026-01-02T00:00:00Z"))).toBe(1_100);
  });
});

describe("periodos, benchmark y costos", () => {
  it("calcula retornos y PnL de una ventana por los valores vigentes en sus extremos", () => {
    const curva: Punto[] = [{ x: 1, y: 1 }, { x: 2, y: 1.1 }, { x: 3, y: 1.21 }];
    const pnl = [{ x: 1, pnl: 0 }, { x: 2, pnl: 10 }, { x: 3, pnl: 31 }];

    // Entre t=2 y t=3: 1,21 / 1,10 - 1 = +10 %; PnL: 31 - 10 = 21 USD.
    expect(twrEntre(curva, 2, 3)).toBeCloseTo(10, 10);
    expect(pnlEntre(pnl, 2, 3)).toBe(21);
  });

  it("compara el benchmark desde la entrada aunque las filas lleguen desordenadas", () => {
    const bench = [
      { date: "2026-01-03", equity_index: 90 },
      { date: "2026-01-01", equity_index: 100 },
      { date: "2026-01-02", equity_index: 120 },
    ];

    // Cliente entra el 2-ene: 90 / 120 - 1 = -25 %, no -10 % desde el 1-ene.
    expect(benchmarkEnVentana(bench, instante("2026-01-02T12:00:00Z"), instante("2026-01-03T12:00:00Z"))).toBeCloseTo(-25, 10);
  });

  it("no duplica comisiones al conmutar de trades historicos a ledger completo", () => {
    const costos = comisionesPorMes(
      [
        { ts: "2026-07-12T23:00:00Z", commission: -4 },
        { ts: "2026-07-13T00:00:00Z", commission: -9 },
      ],
      [
        { ts: "2026-07-12T23:00:00Z", usd: -8 },
        { ts: "2026-07-13T00:00:00Z", usd: -3 },
      ],
    );

    // Antes del corte solo -4 de trades; desde el corte solo -3 del ledger: total julio = -7.
    expect(costos.get("2026-07")).toBe(-7);
  });

  it("usa la ultima barra UTC de cada dia para evitar sumar 24 veces el saldo", () => {
    const filas = ultimoPorDia([
      { ts: "2026-01-02T01:00:00Z", id: "b" },
      { ts: "2026-01-01T23:00:00Z", id: "a2" },
      { ts: "2026-01-01T01:00:00Z", id: "a1" },
    ]);

    expect(filas.map((fila) => fila.id)).toEqual(["a2", "b"]);
  });

  it("calcula el arrastre solo con costos y equities dentro de la ventana", () => {
    const desde = instante("2026-01-01T00:00:00Z");
    const hasta = instante("2026-01-03T00:00:00Z");
    const arrastre = arrastreCostos(
      [snap("2026-01-01T00:00:00Z", 100), snap("2026-01-02T00:00:00Z", 200), snap("2026-01-03T00:00:00Z", 200)],
      [{ ts: "2026-01-02T00:00:00Z", usd: -3 }, { ts: "2026-01-04T00:00:00Z", usd: -99 }],
      [{ ts: "2026-01-03T00:00:00Z", usd: -3 }],
      desde,
      hasta,
    );

    // Equity medio dentro de ventana = (200 + 200) / 2 = 200; costos = -6; arrastre = -3 %.
    expect(arrastre).toBeCloseTo(-3, 10);
  });
});
