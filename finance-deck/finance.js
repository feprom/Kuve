(() => {
  const { backtest, simulation, cohort, replay } = window.kuveFinanceHistory;
  const lang = document.documentElement.lang;
  const colors = { conservador: "#187556", base: "#006b9f", agresivo: "#9c4d12" };
  const currency = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const formattedAmount = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
  const signedAmount = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero", useGrouping: "always" });
  const dateLabel = (options) => new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" });
  const valueLabel = (value, unit) => unit === "money"
    ? currency.format(value)
    : `${percent.format(value)}%`;

  function element(name, attributes, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function plot(svg, getData) {
    function draw() {
      const width = Math.round(svg.clientWidth);
      const height = Math.round(svg.clientHeight);
      if (width < 100 || height < 90) return;

      const { dates, lines, band, unit = "percent", years = false } = getData();
      const right = 13;
      const top = 13;
      const bottom = height - 24;
      const time = dates.map((date) => Date.parse(date));
      const values = lines.flatMap((s) => s.values).concat(band ? [...band.low, ...band.high] : []);
      const baseline = unit === "percent" ? 0 : values[0];
      const min = Math.min(baseline, ...values);
      const max = Math.max(baseline, ...values);
      const span = max - min || Math.max(Math.abs(min), 1) * .08;
      const left = 11 + 7.5 * Math.max(valueLabel(min, unit).length, valueLabel(max, unit).length);
      const low = min - span * .06;
      const high = max + span * .06;
      const x = (i) => left + (time[i] - time[0]) / (time.at(-1) - time[0] || 1) * (width - left - right);
      const y = (value) => top + (high - value) / (high - low) * (bottom - top);
      const coordinates = (points) => points.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`);
      const stamp = years ? dateLabel({ year: "numeric" }) : dateLabel({ month: "short", day: "numeric" });

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.replaceChildren();
      for (let i = 0; i <= 3; i++) {
        const value = min + span / 3 * i;
        const yy = y(value);
        svg.append(element("line", { x1: left, x2: width - right, y1: yy, y2: yy, class: "grid-line" }));
        svg.append(element("text", { x: left - 6, y: yy + 4, "text-anchor": "end" }, valueLabel(value, unit)));
      }

      if (unit === "percent" && min < 0 && max > 0) {
        const yy = y(0);
        svg.append(element("line", { x1: left, x2: width - right, y1: yy, y2: yy, class: "zero-line" }));
      }

      const tickCount = width < 450 ? 3 : 5;
      const tickIndices = [...new Set(Array.from({ length: tickCount }, (_, i) =>
        Math.round(i * (dates.length - 1) / (tickCount - 1))))];
      tickIndices.forEach((index, i) => {
        const labelX = i === 0 ? left - 4 : i === tickIndices.length - 1 ? width - 2 : x(index);
        const labelAnchor = i === 0 ? "start" : i === tickIndices.length - 1 ? "end" : "middle";
        svg.append(element("text", { x: labelX, y: height - 5, "text-anchor": labelAnchor }, stamp.format(time[index])));
      });

      if (band) {
        const region = [...coordinates(band.low), ...coordinates(band.high).reverse()].join(" ");
        svg.append(element("polygon", { points: region, class: "scenario-band" }));
      }

      for (const line of lines) {
        svg.append(element("polyline", {
          points: coordinates(line.values).join(" "), stroke: line.color,
          class: `series-line${line.edge ? " scenario-edge" : ""}${line.reference ? " reference-line" : ""}`,
        }));
        if (!line.edge) {
          svg.append(element("circle", {
            cx: x(line.values.length - 1), cy: y(line.values.at(-1)), r: 4,
            fill: line.color, class: "plot-marker",
          }));
        }
      }
    }

    new ResizeObserver(draw).observe(svg);
    return draw;
  }

  function simulationRun(returns, dates, capital, interval) {
    let savings = capital;
    let balance = capital;
    const savingsLine = [];
    const rentLine = [];
    const payments = [];
    for (const [i, rate] of returns.entries()) {
      savings *= 1 + rate;
      balance *= 1 + rate;
      const month = Number(dates[i].slice(5, 7));
      const monthClosed = dates[i + 1] && dates[i + 1].slice(0, 7) !== dates[i].slice(0, 7);
      if (monthClosed && month % interval === 0) {
        const withdrawal = Math.max(0, balance - capital);
        payments.push(withdrawal);
        balance -= withdrawal;
      }
      savingsLine.push(savings);
      rentLine.push(balance);
    }
    return { savingsLine, rentLine, payments };
  }

  const capitalInput = document.querySelector("#sim-capital");
  const profileInput = document.querySelector("#sim-profile");
  const intervalInput = document.querySelector("#sim-interval");
  const savingsOutput = document.querySelector("#sim-save-out");
  const rentOutput = document.querySelector("#sim-rent-out");
  const balanceOutput = document.querySelector("#sim-balance-out");
  const simChart = document.querySelector("#sim-chart");

  function showSimulation() {
    if (!capitalInput.validity.valid) return;
    const initial = Math.min(capitalInput.valueAsNumber || 10000, 100000000);
    const { savingsLine, rentLine, payments } = simulationRun(
      simulation.rets[profileInput.value], simulation.dates, initial, Number(intervalInput.value),
    );
    savingsOutput.textContent = currency.format(savingsLine.at(-1));
    rentOutput.textContent = currency.format(payments.reduce((sum, payment) => sum + payment, 0));
    balanceOutput.textContent = currency.format(rentLine.at(-1));
    return {
      dates: ["2025-12-31", ...simulation.dates],
      lines: [
        { values: [initial, ...savingsLine], color: colors.base },
        { values: [initial, ...rentLine], color: colors.conservador },
      ],
      unit: "money",
    };
  }

  let scenario = showSimulation();
  const drawSimulation = plot(simChart, () => scenario);
  document.querySelector("#sim-controls").addEventListener("input", () => {
    scenario = showSimulation() ?? scenario;
    drawSimulation();
  });

  const periodInput = document.querySelector("#history-range");
  const historyPoints = (profile, period) => {
    if (period === "daily") {
      let factor = 1;
      return [1, ...simulation.rets[profile].map((r) => (factor *= 1 + r))];
    }
    return [1, ...backtest.profiles[profile]];
  };

  function showHistory() {
    const period = periodInput.value;
    const lines = Object.entries(colors).map(([key, color]) => {
      const points = historyPoints(key, period);
      let peak = 1;
      let worst = 0;
      for (const point of points) {
        peak = Math.max(peak, point);
        worst = Math.min(worst, point / peak - 1);
      }
      const values = points.map((point) => (point - 1) * 100);
      const [returns, drawdown] = document.querySelectorAll(`[data-history-profile="${key}"] td`);
      returns.textContent = valueLabel(values.at(-1), "percent");
      drawdown.textContent = valueLabel(worst * 100, "percent");
      return { values, color };
    });
    return {
      dates: period === "daily" ? ["2025-12-31", ...simulation.dates] : ["2020-12-21", ...backtest.dates],
      lines,
      years: period !== "daily",
    };
  }

  let historical = showHistory();
  const drawHistory = plot(document.querySelector("#history-chart"), () => historical);
  periodInput.addEventListener("change", () => {
    historical = showHistory();
    drawHistory();
  });

  plot(document.querySelector("#profile-chart"), () => ({
    dates: replay.dates,
    lines: [
      { values: replay.lines["2"], color: colors.conservador },
      { values: replay.lines["4"], color: colors.base },
      { values: replay.lines["5"], color: colors.agresivo },
      { values: cohort.days.map(([, value]) => value), color: "#303747", reference: true },
    ],
  }));

  plot(document.querySelector("#cohort-chart"), () => ({
    dates: cohort.days.map(([date]) => date),
    lines: [
      { values: cohort.days.map(([, value]) => value), color: colors.base },
      { values: cohort.founder, color: colors.agresivo },
    ],
  }));

  const outlookProfile = document.querySelector("#outlook-profile");
  function outlookSeries() {
    const { dates, profiles } = cohort.outlook;
    const { paths, percentiles, gains, balances } = profiles[outlookProfile.value];
    for (const [index, name] of ["P10", "P50", "P90"].entries()) {
      const [change, money, total] = document.querySelectorAll(`[data-outlook="${name}"] td`);
      change.textContent = `${signedAmount.format(percentiles[index])}%`;
      money.textContent = signedAmount.format(gains[index]);
      total.textContent = formattedAmount.format(balances[index]);
    }
    const low = paths.map(([value]) => value);
    const mid = paths.map(([, value]) => value);
    const high = paths.map(([, , value]) => value);
    return {
      dates,
      band: { low, high },
      lines: [
        { values: low, color: colors.base, edge: true },
        { values: high, color: colors.base, edge: true },
        { values: mid, color: colors.base },
      ],
    };
  }
  let forecast = outlookSeries();
  const drawOutlook = plot(document.querySelector("#outlook-chart"), () => forecast);
  outlookProfile.addEventListener("change", () => {
    forecast = outlookSeries();
    drawOutlook();
  });
})();
