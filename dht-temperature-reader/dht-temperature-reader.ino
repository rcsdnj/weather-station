#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

#define DHTPIN D5          // Pino de dados do DHT22
#define DHTTYPE DHT22     // Tipo do sensor

const char* ssid = "TchucosHome-2.4GHz";
const char* password = "novasauroras";

const char* serverUrl = "http://rcsdnj-station.duckdns.org/api/temperatura";  // Endpoint do servidor

DHT dht(DHTPIN, DHTTYPE);

unsigned long lastSend = 0;
const unsigned long intervalo = 2000;  // 10 segundos

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Conectando-se ao WiFi");
  WiFi.begin(ssid, password);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nFalha ao conectar ao WiFi.");
  }
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  conectarWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
    // se não conseguir conectar, aguarda até a próxima iteração
    if (WiFi.status() != WL_CONNECTED) return;
  }

  unsigned long now = millis();
  if (now - lastSend >= intervalo) {
    lastSend = now;

    float temp = dht.readTemperature();
    float umid = dht.readHumidity();

    if (isnan(temp) || isnan(umid)) {
      Serial.println("Leitura inválida do DHT22.");
      return;
    }

    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"temperatura\":" + String(temp, 1) + ",\"humidade\":" + String(umid, 1) + "}";
    int httpCode = http.POST(payload);

    if (httpCode > 0) {
      Serial.println("POST enviado com sucesso:");
      Serial.println("Código: " + String(httpCode));
      Serial.println("Payload: " + payload);
    } else {
      Serial.println("Erro ao enviar POST: " + http.errorToString(httpCode));
    }

    http.end();
  }
}
