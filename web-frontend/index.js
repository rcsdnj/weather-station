let unidade = "kmh";
let ultimaLeitura = null;

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
      return `Velocidade do Vento (${getWindUnitLabel()})`;
    case "temperatura":
      return "Temperatura (°C)";
    case "humidade":
      return "Umidade (%)";
    default:
      return metricName;
  }
}

function renderStatsTable(data) {
  const tbody = document.getElementById("stats-body");
  const metricsOrder = ["vento", "temperatura", "humidade"];
  const windowsOrder = ["3h", "6h", "12h", "24h"];

  let html = "";

  metricsOrder.forEach(metricName => {
    const metric = data[metricName];
    if (!metric || !metric.estatisticas) {
      return;
    }

    const stats = metric.estatisticas;

    windowsOrder.forEach((windowKey, index) => {
      const windowStats = stats[windowKey] || {};
      const metricLabel = getMetricLabel(metricName);

      html += `
        <tr>
          ${index === 0 ? `<td rowspan="${windowsOrder.length}" class="metric-name">${metricLabel}</td>` : ""}
          <td>${windowKey}</td>
          <td>${formatMetricValue(metricName, windowStats.max)}</td>
          <td>${formatMetricValue(metricName, windowStats.media)}</td>
          <td>${formatMetricValue(metricName, windowStats.min)}</td>
        </tr>
      `;
    });
  });

  tbody.innerHTML = html || `
    <tr>
      <td colspan="5">Sem dados disponíveis.</td>
    </tr>
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

  renderStatsTable(data);
}

function fetchData() {
  fetch("/api/status")
    .then(resp => resp.json())
    .then(atualizarValores)
    .catch((e) => {
      console.log("erro: " + e);
      document.getElementById("stale").style.display = "block";
      document.getElementById("stats-body").innerHTML = `
        <tr>
          <td colspan="5">Erro ao carregar dados.</td>
        </tr>
      `;
    });
}

setInterval(fetchData, 1000);
fetchData();