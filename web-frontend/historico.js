// "Histórico" panel. Uses helpers and `metricsOrder` from index.js.
(function () {
  const REFRESH_INTERVAL_MS = 60000;
  const FETCH_TIMEOUT_MS = 15000;
  const CHART_HEIGHT = 200;
  const LOCALE = "pt";

  const COLOR_VARS = { vento: "--wind", temperatura: "--temp", humidade: "--hum" };
  const FONT = "12px Arial, Helvetica, sans-serif";
  const AXIS_TEXT = cssVar("--muted");
  const GRID = cssVar("--border");

  const fmtHora = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDia = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit" });
  const fmtMes = new Intl.DateTimeFormat(LOCALE, { month: "short" });
  const fmtDiaAno = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });

  const charts = {};
  let periodo = document.querySelector('input[name="periodo"]:checked').value;
  let historico = null;
  let ultimoPedido = 0;

  const container = document.getElementById("history-charts");
  const note = document.getElementById("history-note");
  const tableDetails = document.getElementById("history-table-details");
  const tableWrapper = document.getElementById("history-table-wrapper");

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  function figureFor(metricName) {
    return container.querySelector(`.history-chart[data-metric="${metricName}"]`);
  }

  function chartValue(metricName, value) {
    if (value === null || value === undefined) {
      return null;
    }
    return metricName === "vento" ? convertWindValue(value) : value;
  }

  function formatTick(timestamp, spanSeconds, tickStep) {
    const date = new Date(timestamp * 1000);
    if (spanSeconds > 90 * 86400) {
      // Compact "dez/25": the locale's own format ("dez. de 25") is too wide for the axis.
      return `${fmtMes.format(date).replace(".", "")}/${String(date.getFullYear()).slice(2)}`;
    }
    if (tickStep >= 86400) {
      return fmtDia.format(date);
    }
    return fmtHora.format(date);
  }

  function formatMomento(timestamp) {
    const date = new Date(timestamp * 1000);
    if (historico && historico.intervalo_s >= 86400) {
      return fmtDiaAno.format(date);
    }
    return `${fmtDia.format(date)} ${fmtHora.format(date)}`;
  }

  function buildYRange(metricName) {
    return (u, min, max) => {
      if (min === null || max === null) {
        return [0, 1];
      }
      const [low, high] = uPlot.rangeNum(min, max, 0.1, true);
      if (metricName === "vento") {
        return [0, Math.max(high, 1)];
      }
      if (metricName === "humidade") {
        return [Math.max(low, 0), Math.min(high, 100)];
      }
      return [low, high];
    };
  }

  function buildTooltipPlugin(metricName, plotElement) {
    const tooltip = document.createElement("div");
    tooltip.className = "history-tooltip";
    tooltip.hidden = true;
    plotElement.appendChild(tooltip);

    function addRow(label, value, withKey) {
      const row = document.createElement("div");
      row.className = "history-tooltip-row";

      const key = document.createElement("span");
      key.className = withKey ? `history-key history-key-${metricName}` : "history-key history-key-none";
      row.appendChild(key);

      const strong = document.createElement("strong");
      strong.textContent = value;
      row.appendChild(strong);

      const name = document.createElement("span");
      name.textContent = label;
      row.appendChild(name);

      tooltip.appendChild(row);
    }

    return {
      hooks: {
        setCursor: u => {
          const { left, idx } = u.cursor;
          if (left === null || left < 0 || idx === null || idx === undefined) {
            tooltip.hidden = true;
            return;
          }

          tooltip.replaceChildren();
          const heading = document.createElement("div");
          heading.className = "history-tooltip-time";
          heading.textContent = formatMomento(u.data[0][idx]);
          tooltip.appendChild(heading);

          const unit = getMetricUnit(metricName);
          const format = value => (value === null || value === undefined ? "--" : `${value.toFixed(1)} ${unit}`);

          if (u.data[1][idx] === null || u.data[1][idx] === undefined) {
            const empty = document.createElement("div");
            empty.textContent = "Sem dados";
            tooltip.appendChild(empty);
          } else {
            addRow("Máx", format(u.data[3][idx]), false);
            addRow("Média", format(u.data[1][idx]), true);
            addRow("Mín", format(u.data[2][idx]), false);
          }

          tooltip.hidden = false;

          // Stay inside the plot: flip to the pointer's left when near the right edge.
          const over = u.over;
          const x = over.offsetLeft + left;
          const width = tooltip.offsetWidth;
          const flip = x + width + 16 > plotElement.clientWidth;
          tooltip.style.left = `${Math.max(0, flip ? x - width - 12 : x + 12)}px`;
          tooltip.style.top = `${over.offsetTop + 8}px`;
        }
      }
    };
  }

  function createChart(metricName) {
    const color = cssVar(COLOR_VARS[metricName]);
    const plotElement = figureFor(metricName).querySelector(".history-plot");
    const axis = {
      stroke: AXIS_TEXT,
      font: FONT,
      grid: { stroke: GRID, width: 1 },
      ticks: { show: false }
    };

    return new uPlot(
      {
        width: Math.max(plotElement.clientWidth, 100),
        height: CHART_HEIGHT,
        // Right padding leaves room for a tick label centred near the edge.
        padding: [8, 20, 0, 0],
        legend: { show: false },
        cursor: {
          y: false,
          sync: { key: "historico" },
          drag: { x: false, y: false, setScale: false },
          points: { size: 8, width: 2, stroke: "#ffffff" }
        },
        scales: {
          x: { time: true },
          y: { range: buildYRange(metricName) }
        },
        axes: [
          {
            ...axis,
            size: 32,
            space: 72,
            values: (u, splits, axisIdx, foundSpace, foundIncr) => {
              const span = u.scales.x.max - u.scales.x.min;
              return splits.map(split => formatTick(split, span, foundIncr));
            }
          },
          {
            ...axis,
            size: 48,
            values: (u, splits) => splits.map(split => split.toLocaleString(LOCALE, { maximumFractionDigits: 1 }))
          }
        ],
        series: [
          {},
          { label: "Média", stroke: color, width: 2, spanGaps: false, points: { show: false } },
          { label: "Mín", stroke: "transparent", width: 0, spanGaps: false, points: { show: false } },
          { label: "Máx", stroke: "transparent", width: 0, spanGaps: false, points: { show: false } }
        ],
        bands: [{ series: [3, 2], fill: hexToRgba(color, 0.1) }],
        plugins: [buildTooltipPlugin(metricName, plotElement)]
      },
      [[], [], [], []],
      plotElement
    );
  }

  function renderCharts() {
    metricsOrder.forEach(metricName => {
      const figure = figureFor(metricName);
      figure.querySelector(".history-unit").textContent = getMetricUnit(metricName);

      if (!historico) {
        return;
      }

      const serie = historico.series[metricName];
      const media = serie.media.map(value => chartValue(metricName, value));
      charts[metricName].setData([
        historico.t,
        media,
        serie.min.map(value => chartValue(metricName, value)),
        serie.max.map(value => chartValue(metricName, value))
      ]);

      const empty = media.every(value => value === null);
      figure.querySelector(".history-empty").hidden = !empty;
    });
  }

  function renderTable() {
    if (!tableDetails.open || !historico) {
      return;
    }

    const groups = metricsOrder
      .map(m => `<th colspan="3" scope="colgroup">${getMetricLabel(m)} (${getMetricUnit(m)})</th>`)
      .join("");
    const columns = metricsOrder.map(() => "<th>Média</th><th>Mín</th><th>Máx</th>").join("");

    const rows = [];
    for (let i = historico.t.length - 1; i >= 0; i--) {
      if (metricsOrder.every(m => historico.series[m].media[i] === null)) {
        continue;
      }
      const cells = metricsOrder
        .map(m => {
          const serie = historico.series[m];
          return [serie.media[i], serie.min[i], serie.max[i]]
            .map(value => `<td>${formatMetricValue(m, value)}</td>`)
            .join("");
        })
        .join("");
      rows.push(`<tr><th scope="row">${formatMomento(historico.t[i])}</th>${cells}</tr>`);
    }

    tableWrapper.innerHTML = rows.length === 0
      ? "<p>Sem dados neste período</p>"
      : `<table class="history-table">
          <thead>
            <tr><th rowspan="2" scope="col">Momento</th>${groups}</tr>
            <tr>${columns}</tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>`;
  }

  function fetchHistorico() {
    const pedido = ++ultimoPedido;
    container.classList.add("is-loading");

    fetch(`/api/historico?periodo=${encodeURIComponent(periodo)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then(resp => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        return resp.json();
      })
      .then(data => {
        // A newer request (the user switched period) supersedes this response.
        if (pedido !== ultimoPedido) {
          return;
        }
        historico = data;
        note.hidden = true;
        renderCharts();
        renderTable();
      })
      .catch(e => {
        console.log("erro: " + e);
        if (pedido === ultimoPedido) {
          note.hidden = false;
        }
      })
      .finally(() => {
        if (pedido === ultimoPedido) {
          container.classList.remove("is-loading");
        }
      });
  }

  metricsOrder.forEach(metricName => {
    charts[metricName] = createChart(metricName);
  });

  new ResizeObserver(() => {
    metricsOrder.forEach(metricName => {
      const plotElement = figureFor(metricName).querySelector(".history-plot");
      const width = plotElement.clientWidth;
      if (width > 0 && charts[metricName].width !== width) {
        charts[metricName].setSize({ width, height: CHART_HEIGHT });
      }
    });
  }).observe(container);

  document.querySelectorAll('input[name="periodo"]').forEach(el => {
    el.addEventListener("change", e => {
      periodo = e.target.value;
      fetchHistorico();
    });
  });

  document.addEventListener("unidadechange", () => {
    renderCharts();
    renderTable();
  });

  tableDetails.addEventListener("toggle", renderTable);

  renderCharts();
  fetchHistorico();
  setInterval(fetchHistorico, REFRESH_INTERVAL_MS);
})();
