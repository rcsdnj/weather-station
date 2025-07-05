#include <WiFi.h>
#include <HTTPClient.h>
#include <ModbusMaster.h>

// Pinos RS485
#define MAX485_DE_RE  D2
#define RS485_RX      D0
#define RS485_TX      D1

// Credenciais WiFi
const char* ssid     = "TchucosHome-2.4GHz";
const char* password = "novasauroras";

// URL do endpoint do servidor
const char* serverUrl = "http://rcsdnj-station.duckdns.org/api/vento";

// Modbus
ModbusMaster node;

unsigned long lastSend = 0;
const unsigned long intervalo = 1000;  // 10 segundos

void preTransmission() {
  digitalWrite(MAX485_DE_RE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_DE_RE, LOW);
}

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

  // Configura RS485
  pinMode(MAX485_DE_RE, OUTPUT);
  digitalWrite(MAX485_DE_RE, LOW);
  Serial2.begin(4800, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial2);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  conectarWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  unsigned long now = millis();
  if (now - lastSend >= intervalo) {
    lastSend = now;

    float velocidade = -1.0;
    uint8_t result = node.readHoldingRegisters(0x0000, 1);
    if (result == node.ku8MBSuccess) {
      velocidade = node.getResponseBuffer(0) / 10.0;
      Serial.println("Velocidade lida: " + String(velocidade, 1) + " m/s");
    } else {
      Serial.println("Erro ao ler sensor: código " + String(result));
      return;
    }

    // Envia via HTTP
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"velocidade\":" + String(velocidade, 1) + "}";
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