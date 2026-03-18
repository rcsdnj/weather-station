let unidade = "kmh";
let ultimaLeitura = null;

const metricsOrder = ["vento", "temperatura", "humidade"];
const windowsOrder = ["3h", "6h", "12h", "24h"];

document.querySelectorAll('input[name="unidade"]').forEach(el => {
  el.addEventListener("change", e => {
    unidade = e.target.value;
    if (ultimaLeitura) {
      atualizarValores(ultimaLeitura);
    }
  });
});

function formatNumber(value, decimals = 1) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num.toFixed(decimals) : "--";
}

function convertWindValue(value) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return unidade === "kmh" ? num * 3.6 : num;
}

function getWindUnitLabel() {
  return unidade === "kmh" ? "km/h" : "m/s";
}

function formatMetricValue(metricName, value) {
  if (metricName === "vento") {
    const converted = convertWindValue(value);
    return converted !== null ? converted.toFixed(1) : "--";
  }
  return formatNumber(value, 1);
}

function getMetricLabel(metricName) {
  switch (metricName) {
    case "vento":
      return "Velocidade do vento";
    case "temperatura":
      return "Temperatura";
    case "humidade":
      return "Humidade";
    default:
      return metricName;
  }
}

function getMetricUnit(metricName) {
  switch (metricName) {
    case "vento":
      return getWindUnitLabel();
    case "temperatura":
      return "°C";
    case "humidade":
      return "%";
    default:
      return "";
  }
}

function getWindowLabel(windowKey) {
  switch (windowKey) {
    case "3h":
      return "Últimas 3h";
    case "6h":
      return "Últimas 6h";
    case "12h":
      return "Últimas 12h";
    case "24h":
      return "Últimas 24h";
    default:
      return windowKey;
  }
}

function renderStatsCards(data) {
  const container = document.getElementById("stats-cards");
  let html = "";

  metricsOrder.forEach(metricName => {
    const metric = data[metricName];
    if (!metric || !metric.estatisticas) {
      return;
    }

    const stats = metric.estatisticas;

    html += `
      <article class="stats-card stats-card-${metricName}">
        <div class="stats-card-header">
          <h3>${getMetricLabel(metricName)}</h3>
          <span class="stats-unit">${getMetricUnit(metricName)}</span>
        </div>

        <div class="stats-table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Janela</th>
                <th>Máx</th>
                <th>Média</th>
                <th>Mín</th>
              </tr>
            </thead>
            <tbody>
    `;

    windowsOrder.forEach(windowKey => {
      const windowStats = stats[windowKey] || {};

      html += `
        <tr>
          <td class="window-cell">${getWindowLabel(windowKey)}</td>
          <td><span class="stat-pill stat-pill-max">${formatMetricValue(metricName, windowStats.max)}</span></td>
          <td><span class="stat-pill stat-pill-avg">${formatMetricValue(metricName, windowStats.media)}</span></td>
          <td><span class="stat-pill stat-pill-min">${formatMetricValue(metricName, windowStats.min)}</span></td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>
      </article>
    `;
  });

  container.innerHTML = html || `
    <div class="stats-card">
      <div class="stats-card-header">
        <h3>Sem dados disponíveis</h3>
      </div>
    </div>
  `;
}

function atualizarValores(data) {
  ultimaLeitura = data;

  const stale =
    data.temperatura?.expirado ||
    data.humidade?.expirado ||
    data.vento?.expirado;

  document.getElementById("stale").style.display = stale ? "block" : "none";

  const vel = convertWindValue(data.vento?.valor);
  const temp = parseFloat(data.temperatura?.valor);
  const hum = parseFloat(data.humidade?.valor);

  document.getElementById("vel").innerText = vel !== null ? vel.toFixed(1) : "--";
  document.getElementById("temp").innerText = Number.isFinite(temp) ? temp.toFixed(1) : "--";
  document.getElementById("hum").innerText = Number.isFinite(hum) ? hum.toFixed(1) : "--";
  document.getElementById("unidade").innerText = getWindUnitLabel();

  renderStatsCards(data);
}

function fetchData() {
  fetch("/api/status")
    .then(resp => resp.json())
    .then(atualizarValores)
    .catch((e) => {
      console.log("erro: " + e);
      document.getElementById("stale").style.display = "block";
      document.getElementById("stats-cards").innerHTML = `
        <div class="stats-card">
          <div class="stats-card-header">
            <h3>Erro ao carregar dados</h3>
          </div>
        </div>
      `;
    });
}

setInterval(fetchData, 1000);
fetchData();