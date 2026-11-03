const UNIDADE_STORAGE_KEY = "estacao.unidadeVento";
const POLL_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 5000;

let unidade = carregarUnidade();
let ultimaLeitura = null;
let ultimaLeituraEm = null;
let statsRenderizadas = null;

const metricsOrder = ["vento", "temperatura", "humidade"];
const windowsOrder = ["3h", "6h", "12h", "24h"];

function carregarUnidade() {
  try {
    const salva = localStorage.getItem(UNIDADE_STORAGE_KEY);
    return salva === "ms" || salva === "kmh" ? salva : "kmh";
  } catch (e) {
    return "kmh";
  }
}

function salvarUnidade() {
  try {
    localStorage.setItem(UNIDADE_STORAGE_KEY, unidade);
  } catch (e) {
    // Without storage the choice simply lasts until the page reloads.
  }
}

document.querySelectorAll('input[name="unidade"]').forEach(el => {
  el.checked = el.value === unidade;
  el.addEventListener("change", e => {
    unidade = e.target.value;
    salvarUnidade();
    document.getElementById("unidade").innerText = getWindUnitLabel();
    if (ultimaLeitura) {
      renderizarValores(ultimaLeitura);
    }
    document.dispatchEvent(new Event("unidadechange"));
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
      return "Vento";
    case "temperatura":
      return "Temperatura";
    case "humidade":
      return "Humidade";
    default:
      return metricName;
  }
}

function getMetricTitle(metricName) {
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

function getMetricIcon(metricName) {
  switch (metricName) {
    case "vento":
      return "🌬️";
    case "temperatura":
      return "🌡️";
    case "humidade":
      return "💧";
    default:
      return "•";
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
          <div class="stats-card-title-wrap">
            <span class="stats-icon" aria-hidden="true">${getMetricIcon(metricName)}</span>
            <h3>${getMetricTitle(metricName)}</h3>
          </div>
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

  html = html || `
    <div class="stats-card">
      <div class="stats-card-header">
        <h3>Sem dados disponíveis</h3>
      </div>
    </div>
  `;

  // Compare the rendered text, not the raw numbers: averages shift in their far
  // decimals on every reading, but the one decimal shown rarely changes.
  if (html !== statsRenderizadas) {
    statsRenderizadas = html;
    container.innerHTML = html;
  }
}

function formatarIdade(segundos) {
  if (segundos < 60) {
    return `${Math.floor(segundos)} s`;
  }
  if (segundos < 3600) {
    return `${Math.floor(segundos / 60)} min`;
  }
  if (segundos < 86400) {
    return `${Math.floor(segundos / 3600)} h`;
  }
  return `${Math.floor(segundos / 86400)} d`;
}

function setBadge(estado, texto) {
  const badge = document.getElementById("status-badge");
  const className = `weather-badge weather-badge-${estado}`;
  if (badge.className !== className) {
    badge.className = className;
  }
  // Only touch the text when it changes, so screen readers announce real changes.
  if (badge.textContent !== texto) {
    badge.textContent = texto;
  }
}

function setCartao(metricName, stale, texto) {
  const card = document.querySelector(`.metric-card[data-metric="${metricName}"]`);
  card.classList.toggle("is-stale", stale);
  card.querySelector(".metric-age").textContent = texto;
}

function renderizarEstado(data) {
  const expirados = metricsOrder.filter(metricName => data[metricName]?.expirado);

  metricsOrder.forEach(metricName => {
    const metric = data[metricName];
    const idade = metric?.idade_s;

    if (idade === null || idade === undefined) {
      setCartao(metricName, true, "Sem dados");
    } else if (metric.expirado) {
      setCartao(metricName, true, `Sem leituras há ${formatarIdade(idade)}`);
    } else {
      setCartao(metricName, false, idade < 5 ? "Atualizado agora" : `Atualizado há ${formatarIdade(idade)}`);
    }
  });

  if (expirados.length === 0) {
    setBadge("ok", "● Estação online");
  } else if (expirados.length === metricsOrder.length) {
    setBadge("offline", "✕ Estação offline");
  } else {
    setBadge("parcial", `⚠ Sem dados: ${expirados.map(getMetricLabel).join(", ")}`);
  }
}

function mostrarSemConexao() {
  setBadge("sem-conexao", "✕ Sem conexão com o servidor");

  if (!ultimaLeitura) {
    metricsOrder.forEach(metricName => setCartao(metricName, true, "Sem conexão"));
    document.getElementById("stats-cards").innerHTML = `
      <div class="stats-card">
        <div class="stats-card-header">
          <h3>Erro ao carregar dados</h3>
        </div>
      </div>
    `;
    return;
  }

  // Keep the last readings on screen, marked as stale, and keep their age counting.
  const decorridos = (performance.now() - ultimaLeituraEm) / 1000;
  metricsOrder.forEach(metricName => {
    const idade = ultimaLeitura[metricName]?.idade_s;
    const texto = idade === null || idade === undefined
      ? "Sem conexão"
      : `Sem conexão · última leitura há ${formatarIdade(idade + decorridos)}`;
    setCartao(metricName, true, texto);
  });
}

function atualizarValores(data) {
  ultimaLeitura = data;
  ultimaLeituraEm = performance.now();
  renderizarValores(data);
  renderizarEstado(data);
}

function renderizarValores(data) {
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
  fetch("/api/status", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(resp => {
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp.json();
    })
    .then(atualizarValores)
    .catch(e => {
      console.log("erro: " + e);
      mostrarSemConexao();
    })
    // Waiting for each response means slow requests can't pile up.
    .finally(() => setTimeout(fetchData, POLL_INTERVAL_MS));
}

document.getElementById("unidade").innerText = getWindUnitLabel();
fetchData();