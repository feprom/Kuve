(() => {
  const { backtest, simulation, cohort, replay } = window.kuveFinanceHistory;
  const lang = document.documentElement.lang;
  const pt = lang.startsWith("pt");
  const colors = { conservador: "#187556", base: "#006b9f", agresivo: "#9c4d12" };
  const profileLabels = { conservador: "KV-2 Conservador", base: "KV-4 Base", agresivo: pt ? "KV-5 Agressivo" : "KV-5 Agresivo" };
  const expandLabel = "Ampliar gráfico";
  const closeLabel = pt ? "Fechar gráfico" : "Cerrar gráfico";
  const helpText = pt ? "Passe o cursor, toque ou use as setas para ver os valores por data." : "Pasa el cursor, toca o usa las flechas para ver los valores por fecha.";
  const currency = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const formattedAmount = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
  const signedAmount = new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero", useGrouping: "always" });
  const dateLabel = (options) => new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" });
  const pointDate = dateLabel({ dateStyle: "medium" });
  const valueLabel = (value, unit) => unit === "money"
    ? currency.format(value)
    : `${percent.format(value)}%`;

  function element(name, attributes, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const chartHelp = document.createElement("p");
  chartHelp.id = "chart-help";
  chartHelp.className = "visually-hidden";
  chartHelp.textContent = helpText;
  document.body.append(chartHelp);

  function plot(svg, getData, expanded = false) {
    const surface = document.createElement("div");
    surface.className = "chart-surface";
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    tooltip.setAttribute("aria-hidden", "true");
    const chartStatus = document.createElement("div");
    chartStatus.className = "visually-hidden";
    chartStatus.setAttribute("role", "status");
    svg.before(surface);
    surface.append(svg, tooltip, chartStatus);
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-describedby", "chart-help");
    svg.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End");

    if (!expanded) {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "control chart-expand";
      trigger.title = expandLabel;
      trigger.setAttribute("aria-label", `${expandLabel} · ${svg.getAttribute("aria-label")}`);
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.append(chartIcon("fullscreen"));
      trigger.addEventListener("click", () => openChart(svg.getAttribute("aria-label"), getData, trigger));
      surface.append(trigger);
    }

    let geometry;
    let cursor;

    function draw() {
      const width = Math.round(svg.clientWidth);
      const height = Math.round(svg.clientHeight);
      const data = getData();
      if (!data || width < 100 || height < 90) return;

      const { dates, lines, band, unit = "percent", years = false } = data;
      const right = expanded ? 13 : 48;
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

      const guides = element("g", { class: "chart-guides", visibility: "hidden" });
      const vertical = element("line", { y1: top, y2: bottom });
      const horizontal = element("line", { x1: left, x2: width - right });
      const dots = lines.map((line) => element("circle", { r: 4, fill: line.color }));
      guides.append(vertical, horizontal, ...dots);
      svg.append(guides);

      geometry = { width, time, dates, lines, unit, xs: dates.map((_, i) => x(i)), y, guides, vertical, horizontal, dots };
      tooltip.hidden = true;
      if (cursor) inspect(Math.min(cursor.index, dates.length - 1));
    }

    function inspect(index, pointerY, announce = false) {
      if (!geometry) return;
      const { width, time, dates, lines, unit, xs, y, guides, vertical, horizontal, dots } = geometry;
      let reference = Math.max(0, lines.findIndex((line) => !line.edge));
      if (pointerY !== undefined) {
        lines.forEach((line, i) => {
          if (Math.abs(y(line.values[index]) - pointerY) < Math.abs(y(lines[reference].values[index]) - pointerY)) reference = i;
        });
      }
      const px = xs[index];
      const py = y(lines[reference].values[index]);
      vertical.setAttribute("x1", px);
      vertical.setAttribute("x2", px);
      horizontal.setAttribute("y1", py);
      horizontal.setAttribute("y2", py);
      dots.forEach((dot, i) => {
        dot.setAttribute("cx", px);
        dot.setAttribute("cy", y(lines[i].values[index]));
      });
      guides.setAttribute("visibility", "visible");

      if (cursor?.date !== dates[index] || tooltip.hidden) {
        const date = document.createElement("strong");
        date.textContent = pointDate.format(time[index]);
        tooltip.replaceChildren(date);
        lines.forEach((line) => {
          const row = document.createElement("div");
          const name = document.createElement("span");
          const amount = document.createElement("span");
          name.style.setProperty("--point-color", line.color);
          name.textContent = line.label;
          const value = line.values[index];
          amount.textContent = unit === "money"
            ? `${formattedAmount.format(value)} USDT (${signedAmount.format((value / line.values[0] - 1) * 100)}%)`
            : `${signedAmount.format(value)}%`;
          row.append(name, amount);
          tooltip.append(row);
        });
      }
      cursor = { index, date: dates[index] };
      tooltip.hidden = false;
      const tooltipWidth = tooltip.offsetWidth;
      const preferred = px + tooltipWidth + 12 <= width ? px + 12 : px - tooltipWidth - 12;
      tooltip.style.left = `${Math.max(0, Math.min(preferred, width - tooltipWidth))}px`;
      if (announce) chartStatus.textContent = [...tooltip.children].map((row) =>
        row.childElementCount ? [...row.children].map((cell) => cell.textContent).join(" ") : row.textContent,
      ).join(". ");
    }

    function clear() {
      cursor = undefined;
      geometry?.guides.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    }

    function followPointer(event) {
      if (!geometry) return;
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const index = geometry.xs.reduce((best, x, i, values) =>
        Math.abs(x - px) < Math.abs(values[best] - px) ? i : best, 0);
      inspect(index, event.clientY - rect.top);
    }

    svg.addEventListener("pointermove", followPointer);
    svg.addEventListener("pointerdown", followPointer);
    svg.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") clear(); });
    svg.addEventListener("pointercancel", clear);
    svg.addEventListener("blur", clear);
    svg.addEventListener("focus", () => {
      if (geometry && svg.matches(":focus-visible") && !cursor) inspect(geometry.dates.length - 1, undefined, true);
    });
    svg.addEventListener("keydown", (event) => {
      if (!geometry || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "Escape" && !expanded && cursor) {
        event.preventDefault();
        clear();
        return;
      }
      const last = geometry.dates.length - 1;
      const index = cursor?.index ?? last;
      const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last };
      if (!Object.hasOwn(target, event.key)) return;
      event.preventDefault();
      inspect(Math.max(0, Math.min(target[event.key], last)), undefined, true);
    });

    new ResizeObserver(draw).observe(svg);
    return { draw, clear, inspectLast: () => { if (geometry) inspect(geometry.dates.length - 1); } };
  }

  function chartIcon(name) {
    const icon = element("svg", { "aria-hidden": "true" });
    icon.append(element("use", { href: `#icon-${name}` }));
    return icon;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "chart-dialog";
  dialog.setAttribute("aria-labelledby", "chart-dialog-title");
  const dialogHead = document.createElement("div");
  dialogHead.className = "dialog-head";
  const dialogTitle = document.createElement("h2");
  dialogTitle.id = "chart-dialog-title";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "control";
  close.setAttribute("aria-label", closeLabel);
  close.append(chartIcon("close"));
  close.addEventListener("click", () => dialog.close());
  const dialogChart = element("svg", { class: "chart", role: "img" });
  const dialogHelp = document.createElement("p");
  dialogHelp.id = "chart-dialog-help";
  dialogHelp.textContent = helpText;
  dialogHead.append(dialogTitle, close);
  dialog.append(dialogHead, dialogChart, dialogHelp);
  document.body.append(dialog);

  let source;
  let opener;
  const enlarged = plot(dialogChart, () => source?.(), true);
  dialogChart.setAttribute("aria-describedby", dialogHelp.id);

  function openChart(title, getData, trigger) {
    source = getData;
    opener = trigger;
    enlarged.clear();
    dialogTitle.textContent = title;
    dialogChart.setAttribute("aria-label", title);
    dialog.showModal();
    enlarged.draw();
    dialogChart.focus({ preventScroll: true });
    enlarged.inspectLast();
  }

  dialog.addEventListener("close", () => {
    enlarged.clear();
    source = undefined;
    opener?.focus({ preventScroll: true });
    opener = undefined;
  });

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
        { values: [initial, ...savingsLine], color: colors.base, label: pt ? "Saldo em poupança" : "Saldo ahorro" },
        { values: [initial, ...rentLine], color: colors.conservador, label: pt ? "Saldo em renda" : "Saldo renta" },
      ],
      unit: "money",
    };
  }

  let scenario = showSimulation();
  const simulationPlot = plot(simChart, () => scenario);
  document.querySelector("#sim-controls").addEventListener("input", () => {
    scenario = showSimulation() ?? scenario;
    simulationPlot.draw();
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
      return { values, color, label: profileLabels[key] };
    });
    return {
      dates: period === "daily" ? ["2025-12-31", ...simulation.dates] : ["2020-12-21", ...backtest.dates],
      lines,
      years: period !== "daily",
    };
  }

  let historical = showHistory();
  const historyPlot = plot(document.querySelector("#history-chart"), () => historical);
  periodInput.addEventListener("change", () => {
    historical = showHistory();
    historyPlot.draw();
  });

  plot(document.querySelector("#profile-chart"), () => ({
    dates: replay.dates,
    lines: [
      { values: replay.lines["2"], color: colors.conservador, label: profileLabels.conservador },
      { values: replay.lines["4"], color: colors.base, label: profileLabels.base },
      { values: replay.lines["5"], color: colors.agresivo, label: profileLabels.agresivo },
      { values: cohort.days.map(([, value]) => value), color: "#303747", label: pt ? "Contas reais" : "Cuentas reales", reference: true },
    ],
  }));

  plot(document.querySelector("#cohort-chart"), () => ({
    dates: cohort.days.map(([date]) => date),
    lines: [
      { values: cohort.days.map(([, value]) => value), color: colors.base, label: "Conjunto" },
      { values: cohort.founder, color: colors.agresivo, label: pt ? "Conta do Mario" : "Cuenta de Mario" },
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
        { values: low, color: colors.base, label: "P10", edge: true },
        { values: mid, color: colors.base, label: "P50" },
        { values: high, color: colors.base, label: "P90", edge: true },
      ],
    };
  }
  let forecast = outlookSeries();
  const outlookPlot = plot(document.querySelector("#outlook-chart"), () => forecast);
  outlookProfile.addEventListener("change", () => {
    forecast = outlookSeries();
    outlookPlot.draw();
  });
})();
