let unidade = "kmh";
let ultimaLeitura = null;

document.querySelectorAll('input[name="unidade"]').forEach(el => {
  el.addEventListener("change", e => {
    unidade = e.target.value;
    if (ultimaLeitura) atualizarValores(ultimaLeitura);
  });
});

function atualizarValores(data) {
  ultimaLeitura = data;
  const stale = data.temperatura.expirado || data.humidade.expirado || data.vento.expirado;
  document.getElementById("stale").style.display = stale ? "block" : "none";

  const velRaw = parseFloat(data.vento.valor);
  const vel = isNaN(velRaw) ? null : (unidade === "kmh" ? velRaw * 3.6 : velRaw);
  const temp = parseFloat(data.temperatura.valor);
  const hum = parseFloat(data.humidade.valor);

  document.getElementById("vel").innerText = vel !== null ? vel.toFixed(1) : "--";
  document.getElementById("temp").innerText = !isNaN(temp) ? temp.toFixed(1) : "--";
  document.getElementById("hum").innerText = !isNaN(hum) ? hum.toFixed(1) : "--";
  document.getElementById("unidade").innerText = unidade === "kmh" ? "km/h" : "m/s";

  const ts = new Date().toLocaleTimeString();
  chart.data.labels.push(ts);
  chart.data.datasets[0].data.push(vel ?? null);
  chart.data.datasets[1].data.push(!isNaN(temp) ? temp : null);
  chart.data.datasets[2].data.push(!isNaN(hum) ? hum : null);

  if (chart.data.labels.length > 30) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(ds => ds.data.shift());
  }
  chart.update();
}

const ctx = document.getElementById("grafico").getContext("2d");
const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Velocidade do Vento",
        data: [],
        borderColor: "gold",
        yAxisID: "y1",
        fill: false,
        tension: 0.3
      },
      {
        label: "Temperatura (°C)",
        data: [],
        borderColor: "red",
        yAxisID: "y2",
        fill: false,
        tension: 0.3
      },
      {
        label: "Umidade (%)",
        data: [],
        borderColor: "blue",
        yAxisID: "y3",
        fill: false,
        tension: 0.3
      }
    ]
  },
  options: {
    responsive: true,
    interaction: { mode: "index", intersect: false },
    stacked: false,
    scales: {
      x: {
        title: { display: true, text: "Hora" }
      },
      y1: {
        type: "linear",
        display: true,
        position: "left",
        title: { display: true, text: "Velocidade" }
      },
      y2: {
        type: "linear",
        display: true,
        position: "right",
        title: { display: true, text: "Temperatura" },
        grid: { drawOnChartArea: false }
      },
      y3: {
        type: "linear",
        display: true,
        position: "right",
        offset: true,
        title: { display: true, text: "Umidade" },
        grid: { drawOnChartArea: false }
      }
    }
  }
});

function fetchData() {
  fetch("/api/status")
    .then(resp => resp.json())
    .then(atualizarValores)
    .catch((e) => {
      console.log('erro: ' + e);
      document.getElementById("stale").style.display = "block";
    });
}

setInterval(fetchData, 1000);
fetchData();
